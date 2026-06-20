# Luckfox PicoKVM —— 把编译好的 kvm_app 替换进实机（部署/回滚）

> 适用工程：`~/Documents/picokvm`（见记忆 `picokvm-build-env`）。
> **本文是改动流程的「最后一步（第六步）」**：第一步＝安全加固 [PICOKVM_SECURITY_HARDENING.md](PICOKVM_SECURITY_HARDENING.md)；第二步＝拆远程组网 [PICOKVM_STRIP_REMOTE_NET.md](PICOKVM_STRIP_REMOTE_NET.md)；
> 第三步＝登录 fail2ban [PICOKVM_FAIL2BAN_LOGIN.md](PICOKVM_FAIL2BAN_LOGIN.md)；第四步＝USB 改造 [PICOKVM_USB_STORAGE.md](PICOKVM_USB_STORAGE.md)；第五步＝键盘右修饰键 [PICOKVM_KEYBOARD_RIGHT_MODIFIERS.md](PICOKVM_KEYBOARD_RIGHT_MODIFIERS.md)；第六步＝按本文把产物部署到实机验证。
> 首次实施并验证通过：2026-06-20。

---

## 0. 实机环境（首次摸到的事实，复用时先核对）
- 设备：**`<DEVICE_IP>`**，hostname `picokvm`，Linux **5.10.160 armv7l**（＝构建目标 `GOARCH=arm GOARM=7`，吻合）。
- SSH：**`root@<DEVICE_IP>` 已配置免密 SSH key**（从构建主机直接 `ssh root@<DEVICE_IP>` 即进，无需密码）。
- 目标二进制：**`/userdata/picokvm/bin/kvm_app`**；运行日志：**`/tmp/kvm_app.log`**；`/userdata` 约 5G、余量充足。
- 系统版本 `/version` = **0.1.7**（手动替换 app 不动系统）。
- 启动方式：开机由 **`/oem/usr/bin/RkLunch.sh`** 执行
  `chmod +x /userdata/picokvm/bin/kvm_app; /userdata/picokvm/bin/kvm_app > /tmp/kvm_app.log 2>&1 &`。
  **父进程是 init、没有守护进程自动拉起** → 直接 kill 不会自启；要让新二进制生效得 **reboot**（最干净）或手动重新拉起。

---

## 1. 构建产物（部署前必做）
```bash
cd ~/Documents/picokvm
export PATH="$HOME/sdk/go1.25.5/bin:$PATH"
make build_dev          # 仅 Go；前端如改过要先 make frontend 生成 static/
ls -lh bin/kvm_app && file bin/kvm_app   # 期望 ELF 32-bit ARM EABI5, statically linked
```
⚠️ **改完源码务必重新 `make build_dev`**：`bin/kvm_app` 不会自动跟随源码更新——曾因部署了改动前的旧产物踩坑。

---

## 2. 部署流程（已验证，全程 SSH key、无需密码）

```bash
cd ~/Documents/picokvm
DEV=root@<DEVICE_IP>
APP=/userdata/picokvm/bin/kvm_app

# (若设备刷过机/换过机) SSH 主机指纹会变，先清旧指纹再连
ssh-keygen -R <DEVICE_IP>

# 1) 备份原二进制（仅首次，保留最初的可回滚版本，别被二次部署覆盖）
ssh $DEV "[ -f $APP.bak ] || cp -a $APP $APP.bak; ls -l $APP.bak"

# 2) 传到 .new（不直接覆盖运行中的文件，避免 text file busy）
scp bin/kvm_app $DEV:$APP.new

# 3) 校验完整性（本地 vs 设备 sha256 必须一致）
sha256sum bin/kvm_app | awk '{print $1}'
ssh $DEV "sha256sum $APP.new | awk '{print \$1}'"

# 4) 就位
ssh $DEV "chmod +x $APP.new && mv -f $APP.new $APP && ls -l $APP $APP.bak"

# 5) 重启使新二进制生效（无守护进程，必须 reboot 或手动重拉）
ssh $DEV "sync; (sleep 1; reboot) >/dev/null 2>&1 &"
```

> 不想 reboot 的快速法（次选，可能残留旧 native 子进程/socket，首次部署不建议）：
> `ssh $DEV "pkill -x kvm_app; sleep 1; setsid $APP > /tmp/kvm_app.log 2>&1 &"`

---

## 3. 验证（设备约 30–60s 回来）
```bash
DEV=root@<DEVICE_IP>
# 等 SSH 回来后：
ssh $DEV 'ps -w | grep -v grep | grep kvm_app'      # 进程在跑
ssh $DEV "sha256sum /userdata/picokvm/bin/kvm_app"  # 磁盘 sha = 本地新版（证明换对了文件）
ssh $DEV 'tail -n 20 /tmp/kvm_app.log'              # 启动日志无 panic；能看到 WebRTC/串口正常
# 功能性确认「新版确实在跑」：用本次改动新增/变化的行为做探针，例如 fail2ban 的公开端点：
curl -fsSL -k --max-time 6 http://<DEVICE_IP>/auth/banned   # 返回 {"banned":[]} 即新版在跑
```
判据：进程在、磁盘 sha 对、日志无崩溃、探针端点按新行为响应、浏览器能正常出图/操作（WebRTC 本地直连）。

---

## 4. 回滚（出问题一键还原最初版本）
```bash
ssh root@<DEVICE_IP> 'mv -f /userdata/picokvm/bin/kvm_app.bak /userdata/picokvm/bin/kvm_app && reboot'
```
即使新二进制启动崩溃也能回滚：RkLunch.sh 只是 `kvm_app &`，崩溃不影响系统启动，SSH 照常可登 → 还原备份再重启。

---

## 5. 备注
- 产物是 `build_dev`（版本 0.1.3-dev、**未签名**）。手动替换 `/userdata/picokvm/bin/kvm_app` 直接 exec，不过 OTA 签名校验，可正常跑；**不影响系统 0.1.7**。
- **⚠️ 让官方 OTA 真正可用（检测+校验+应用）的完整构建配方**——默认 `make build_dev` 两处都不满足：
  ```bash
  make build_dev VERSION_DEV=0.1.3 \
       OTA_PUBLIC_KEY=4d78341c5c66fd5c09635d45ad3aa0ae7ab131f9e945868ec9726fbc1367a452
  ```
  1. **版本号**：默认 `0.1.3-dev` 是 semver 预发布版（< 0.1.3），`ota.go:GetUpdateStatus` 按 `remote.GreaterThan(local)` 比较 → 本地永远落后、版本号非正式、OTA 状态乱。用 `VERSION_DEV=0.1.3` 让本地＝官方当前版，官方发新版即检出。
  2. **OTA 公钥**：默认 `builtOtaPublicKey` 为空 → 官方更新带签名时 `verifyFile`(ota.go:1166-1177) 走到 `verifyFileSignature` 返回 `(present=true, err="no public key embedded")` → **直接 `signature verification failed`，OTA 中止**（页面提示 "No Embedded Public Key"）。必须内嵌**官方公钥**才能校验官方签名。
     - 该公钥＝出厂二进制内嵌的那个，可从设备 `/userdata/picokvm/bin/kvm_app.bak`（出厂官方版）提取：
       `ssh root@<DEVICE_IP> "strings .../kvm_app.bak | grep -E '^[0-9a-f]{64}$'"`（出厂版正好 1 个、自构建 0 个）。公钥是公开信息、可安全内嵌；**不要**改仓库 Makefile 默认（上游故意把 `OTA_PUBLIC_KEY ?=` 留空、由 CI 注入）——只在本地命令行传。
- **本套改动的预期 OTA 工作流**（官方约半年更一次）：官方发新版 → 在设备页面点 OTA → **刷成官方原版、覆盖掉所有自定义改动**（安全加固/拆除/fail2ban/USB/键盘 全没，这是预期行为）→ `git fetch upstream && merge` 同步官方代码 → 按前五篇文档重做第 1-5 步（**安全加固最先**）→ 用上面配方重新构建并部署。
- 另一种官方上传途径（README）：MTP——把 kvm_app 拷进共享 MTP 目录再替换；本机直连场景 SSH/scp 更快。
- 部署的是哪个分支的产物要心里有数（如 `strip-remote-vpn` 同时含拆除+fail2ban）。

## 6. 同步上游后的完整流程串联
```text
git fetch upstream && merge   →  第一步 PICOKVM_SECURITY_HARDENING（安全加固复查）
                               →  第二步 PICOKVM_STRIP_REMOTE_NET（拆远程组网）
                               →  第三步 PICOKVM_FAIL2BAN_LOGIN（登录 fail2ban）
                               →  第四步 PICOKVM_USB_STORAGE（USB 虚拟介质改造）
                               →  第五步 PICOKVM_KEYBOARD_RIGHT_MODIFIERS（右 Ctrl/Shift 透传）
                               →  make build_dev
                               →  第六步（本文）部署到 <DEVICE_IP> + 验证
```
