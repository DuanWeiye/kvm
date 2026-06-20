# Luckfox PicoKVM —— USB 虚拟介质：TF 卡镜像可写 + 默认不自动挂载

> 适用工程：`~/Documents/picokvm`（见记忆 `picokvm-build-env`）。
> **本文是改动方法论的「第三步」**（部署已调整到本步之后）：
> ①拆远程组网 [PICOKVM_STRIP_REMOTE_NET.md](PICOKVM_STRIP_REMOTE_NET.md)；②登录 fail2ban [PICOKVM_FAIL2BAN_LOGIN.md](PICOKVM_FAIL2BAN_LOGIN.md)；
> ③（本文）USB 改造；④部署到实机 [PICOKVM_DEPLOY_DEVICE.md](PICOKVM_DEPLOY_DEVICE.md)＝最后一步。
> 目标：让 PicoKVM 呈给**目标机**的虚拟 U 盘 —— ①**TF 卡上的镜像可写**（默认全只读）；②**开机不自动挂载** system_info.img。
> 首次实施：2026-06-20，分支 `strip-remote-vpn`，部署产物 sha256 `aa1391fa…`。

---

## 0. 必懂的背景：这个「USB 盘」是什么

PicoKVM 作为 USB 设备插进目标机，对外暴露多个 gadget function。用户看到的「自动挂载、只读的 U 盘」=
**USB Mass Storage（虚拟介质 / Virtual Media）**，与 MTP 是两套东西：

| 通道 | 后端 | 给目标机看到的 | 默认可写? |
|---|---|---|---|
| **Mass Storage**（本文主角） | configfs `mass_storage.usb0/lun.0`，backing 是一个镜像文件 | 一个块设备(磁盘/光驱) | **否（`ro=1` 写死）** |
| MTP | `umtprd` + functionfs，暴露目录 | 像手机/相机的 MTP 设备 | 是（conf 里 `"rw"`） |

- **自动挂载**来自 `usb.go:initSystemInfo()`：开机联网后生成 `system_info.img`（含本机 IP 等，方便找到 KVM）
  并 `rpcMountWithStorage("system_info.img", Disk)` 挂上。受 `config.AutoMountSystemInfo` 控制。
- **只读**来自 `internal/usbgadget/mass_storage.go` 的 `massStorageLun0Config.attrs`：`cdrom:"1"`、**`ro:"1"`**。
  全代码**没有任何地方把 `ro` 改回 0**，`setMassStorageMode()` 原来只切 `cdrom` 不动 `ro` → 不管挂什么镜像，目标机看到的都是只读盘。

**镜像来源 4 种**（`VirtualMediaSource`，决定能否可写）：
`Storage`(内置 `/userdata/picokvm/share`)、`SDStorage`(TF 卡 `/mnt/sdcard`)、`WebRTC`、`HTTP`。
后两者经 **NBD**(`block_device.go`) 提供，其后端 `remoteImageBackend.WriteAt` 直接 `return "not supported"`、NBD server `ReadOnly:true`
→ **远程镜像物理上不可写，必须保持 `ro=1`**，否则目标机写盘报 I/O 错。

---

## 1. 改动一：让 TF 卡镜像可写

**思路**：把 LUN 的 `ro` 属性从「写死 1」改成「按 来源+模式 决定」。只放开 **SDStorage + Disk 模式**，其余全留只读。

### 1.1 核心：`setMassStorageMode` 增加 `readOnly` 参数（`usb_mass_storage.go`）

`ro` 和 `cdrom` 一样是 LUN 的 configfs 属性，改法完全复用现成的 `cdrom` 那条路径：
`gadget.OverrideGadgetConfig("mass_storage_lun0", "ro", "0"/"1")` + `gadget.UpdateGadgetConfig()`。

```go
// setMassStorageMode 设置虚拟介质 LUN 的呈现方式。
// cdrom: 目标机看到光驱(true)还是普通磁盘(false)；readOnly: ro 属性(true=只读,false=可写)。
// CDROM 必须只读；只有真实可写文件后端(如 TF 卡 .img)才允许 readOnly=false；远程 NBD 镜像必须只读。
func setMassStorageMode(cdrom bool, readOnly bool) error {
    cdromMode := "0"; if cdrom { cdromMode = "1" }
    roMode := "0";    if readOnly { roMode = "1" }
    _, cdromChanged := gadget.OverrideGadgetConfig("mass_storage_lun0", "cdrom", cdromMode) // 省略 err 检查
    _, roChanged    := gadget.OverrideGadgetConfig("mass_storage_lun0", "ro", roMode)
    if !cdromChanged && !roChanged { return nil }
    return gadget.UpdateGadgetConfig()
}
```

### 1.2 4 个挂载调用点按来源传只读标志

| 调用点(`usb_mass_storage.go`) | 来源 | 传参 |
|---|---|---|
| `rpcMountWithHTTP` | HTTP(NBD) | `setMassStorageMode(mode==CDROM, true)` 强制只读 |
| `rpcMountWithWebRTC` | WebRTC(NBD) | `setMassStorageMode(mode==CDROM, true)` 强制只读 |
| `rpcMountWithStorage` | 内置 share | `setMassStorageMode(mode==CDROM, true)` 保持只读 |
| **`rpcMountWithSDStorage`** | **TF 卡** | `isCDROM := mode==CDROM; setMassStorageMode(isCDROM, isCDROM)` → **Disk 模式 ro=0 可写**，CDROM 仍只读 |

### 1.3 运行时 RPC 也要同步（`jsonrpc.go:rpcSetMassStorageMode`）

这个独立 RPC 切换 cdrom/file 模式、本身不知道来源，让它与挂载逻辑一致：
```go
readOnly := true
if !cdrom { // file(disk) 模式且当前是 TF 卡来源才放开写
    if st, _ := rpcGetVirtualMediaState(); st != nil && st.Source == SDStorage { readOnly = false }
}
err := setMassStorageMode(cdrom, readOnly)
```

### 1.4 为什么这样安全（机制确认）

- `OverrideGadgetConfig` 改的是 `u.configMap[item].attrs[attr]`（map 是引用类型，与静态默认共享底层）；
  `UpdateGadgetConfig`→`loadGadgetConfig()`(**不重置 configMap**，只刷 base/base_info)→`configureUsbGadget`(rebind)。
  所以 `ro` 覆盖会随重建写下去、不被默认 `1` 冲掉——和 production 在用的 `cdrom` 覆盖同一机制。
- f_mass_storage 改 `ro`/`cdrom` 需 LUN 无 backing 文件 / UDC 未绑定；挂载时序是「先 `setMassStorageMode`(rebind, 此时 file 为空)→再 `setMassStorageImage(file)`」，
  且新挂载前 `currentVirtualMediaState==nil`、上次 unmount 已把 file 置 "\n"，故设 `ro` 时无介质，安全。`config_tx.go` 对 mass_storage lun 属性已有 unbind 处理。
- `internal/usbgadget/mass_storage.go` 的静态默认 `ro:"1"` **不用改**——留作安全默认，按需在挂载时翻成 0 即可。

> ⚠️ 使用前提：①目标机写的是 PicoKVM 上那个 `.img` 文件，得先有真实可写镜像(目标机认识的 FAT/exFAT 等格式)；
> ②**同一 `.img` 别让目标机和 PicoKVM 自身同时挂载读写**，会写花文件系统（正常用法里 PicoKVM 只把 img 当裸块设备丢给 gadget、不挂它的 fs）。

---

## 2. 改动二：默认不自动挂载 system_info.img

### 2.1 改默认值（`config.go`）
```go
AutoMountSystemInfo:  false, // 原 true
```
`initSystemInfo()`(`usb.go`) 开头 `if !config.AutoMountSystemInfo { return }`，置 false 即不自动挂。

### 2.2 ⚠️ 关键坑：改默认值对**已部署设备无效**

`LoadConfig()`(`config.go`) 是「**默认值打底 + 存档 JSON 覆盖**」：
```go
loadedConfig := *defaultConfig
json.Unmarshal(savedJSON, &loadedConfig) // /userdata/kvm_config.json 覆盖默认
```
设备上 `/userdata/kvm_config.json` 几乎必已存 `"auto_mount_system_info_img":true`（main.go 早期会 SaveConfig），
会盖过新代码默认。**改代码默认只对全新/刷机后配置生效**。
现有设备要关：在 Web UI 的 Mount/文件管理面板把「自动挂载 system_info.img」开关关掉（走 `setAutoMountSystemInfo` RPC，会持久化成 false）。

### 2.3 开机自动挂载链（`main.go`，`isNewEnoughSystem` 分支内，顺序）
```
initUsbGadget() → setInitialVirtualMediaState() → initImagesFolder()
→ remountPersistedVirtualMediaState()   // 记住上次手动挂的(PersistedVirtualMediaState)
→ initJiggler() → initSystemInfo()      // 受 AutoMountSystemInfo 控，挂 system_info.img
```
两个「自动挂载」入口：`initSystemInfo`(系统信息盘) 与 `remountPersistedVirtualMediaState`(上次挂载)。
本次只关前者；后者是「记住上次选择」特性，正常只有手动挂过才触发。

---

## 3. 构建 / 部署 / 验证

构建与部署照 [PICOKVM_DEPLOY_DEVICE.md](PICOKVM_DEPLOY_DEVICE.md)：`make build_dev`（**改了前端要先 `npm run build:device` 出 static**）→ scp→sha 校验→mv→reboot。

**验证「新版在跑」的两个坑**：
1. **前端资源走 `/static/` 前缀**（`web.go` `r.StaticFS("/static", …)`，`NoRoute` 才回退 index.html）。
   验证别请求 `/assets/...`（会命中 SPA 回退、返回 1.4KB 的 index.html 假象），要请求 `/static/assets/index-<hash>.js`：
   ```bash
   curl -fsS -o /dev/null -w "%{http_code} %{content_type} %{size_download}\n" \
     http://<DEVICE_IP>/static/assets/index-<hash>.js   # 期望 200 text/javascript 且大小≈本地构建
   ```
   或核 `curl .../index.html | grep -oE '/static/assets/index-[A-Za-z0-9]+\.(js|css)'` 的哈希 == 本地 `static/index.html`。
2. **reboot 后第一次 SSH/HTTP 可能连到「重启尚未真正发生前的旧进程」**（`(sleep 1; reboot)&` 有延迟），
   且 `/auth/banned` 这种老版也有的端点分辨不出新旧。**用 `cat /proc/uptime` 归零** 或独有的前端资源哈希确认是否真在跑新版。

**功能验收**（浏览器，先 Ctrl+Shift+R 清缓存）：
- TF 卡可写：TF 卡放可写 `.img` → UI 以 **Disk 模式**从 SD 存储挂载 → 目标机能写入。
- 自动挂载：现设备需在 Mount 面板手动关那个开关（见 §2.2）。

---

## 4. 同步上游后复用（grep 锚点，行号每次会变）
```bash
cd ~/Documents/picokvm
grep -nE 'func setMassStorageMode|setMassStorageMode\(' usb_mass_storage.go jsonrpc.go   # 可写改动落点
grep -rn '"ro"' internal/usbgadget/mass_storage.go                                        # 静态默认 ro
grep -n 'AutoMountSystemInfo' config.go usb.go jsonrpc.go                                  # 自动挂载开关
grep -n 'rpcMountWithSDStorage\|rpcMountWithStorage\|rpcMountWith\(HTTP\|WebRTC\)' usb_mass_storage.go
```
官方若重构虚拟介质（如把 ro/cdrom 改成单独 RPC、或新增镜像来源），先跑上面 grep 再按 §1/§2 的「按来源给只读标志」「默认值+LoadConfig 合并坑」思路重做。
