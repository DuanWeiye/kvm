# Luckfox PicoKVM —— 拆除「远程组网/穿透」组件方法论

> 适用工程：`~/Documents/picokvm`（fork 自 `LuckfoxTECH/kvm`，JetKVM 二次开发，Go 后端 + React/Vite 前端，详见记忆 `picokvm-build-env`）。
> 目标：把 **TailScale / ZeroTier / WireGuard / EasyTier / Vnt / Cloudflare(Tunnel)** 等远程组网/穿透后端干净拆掉，
> **保留** WebRTC 本地直连、FRP(frpc) 内网穿透。
> **本文是改动流程的「第二步」**（第一步＝安全加固 [PICOKVM_SECURITY_HARDENING.md](PICOKVM_SECURITY_HARDENING.md)，每次同步上游后最先做）。
> 用途：官方源更新后，`git fetch upstream && merge` 同步最新代码，再用本文方法快速重新拆除。
> 首次实施：2026-06-20，分支 `strip-remote-vpn`（参照实现）。

---

## 0. 一句话思路

**先调研定位、再分层拆除（后端→前端）、每层用「编译」当测试网。** 拆之前务必用 grep 摸清耦合，
分清「要删的功能」「要保留的同名陷阱」「跨模块复用的基础设施」，再动手。

---

## 1. 工程关键事实（拆之前必须知道）

- **这是「app」源码，不含「系统」**：系统(内核/rootfs/uboot 的 A/B 固件)在独立仓 `kvm_system`+CDN，由 `rk_ota` 刷。本文只动 app。
- **「云中转」其实已不存在**：此 Luckfox 版后端**没有** JetKVM 云接入逻辑（`main.go` 不连云、`config.go` 无 cloud 字段、前端无设备云注册 UI）。`cloud.go` 只剩**本地直连信令** `handleSessionRequest`（必须保留）。所以「去掉 webRTC 云访问」无功能可删——本地直连本来就是现状。
- **远程访问真正的两类**：① WebRTC 本地直连（浏览器直连设备 IP，信令走 `/webrtc/signaling/client` websocket）；② 外网穿透/组网（本文要拆的 6 个 + 要保留的 FRP）。
- **WebRTC 是传输底座，不是可选项**：视频/音频/键鼠 HID/串口/终端/虚拟 U 盘全跑在 WebRTC DataChannel/Track 上。**绝不能动 `webrtc.go`、`cloud.go` 的 `handleSessionRequest`、`web.go` 的 `/webrtc/*` 路由。**

---

## 2. 调研/定位命令（复用时第一步，行号每次会变→靠锚点）

```bash
cd ~/Documents/picokvm
EXCL='--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=static'

# 2.1 各功能命中的后端文件（看耦合范围）
for p in tailscale zerotier wireguard easytier '\bvnt\b' cloudflare; do
  echo "== $p =="; grep -rEil $EXCL "$p" --include=*.go .
done

# 2.2 后端组网逻辑集中处（这几个文件是主战场）
#   vpn.go         —— 各后端的 rpc* 实现 + initVPN 自启动
#   native_vpn.go  —— vpnctrl 子系统(unix socket 调外部 kvm_vpn 进程)，仅服务 tailscale/zerotier
#   tools.go       —— VpnTool 下载器(从 github release 拉 easytier/vnt/cloudflared/frpc 二进制)
#   config.go      —— 各后端的 *AutoStart / *Config 字段 + 默认值 + 类型
#   jsonrpc.go     —— RPC 方法注册表(一个 map[string]...)
#   main.go        —— 启动点(StartVpnCtrlSocketServer / ExtractAndRunVpnBin / initVPN)

# 2.3 RPC 注册点(决定前端能调到哪些方法)
grep -nEi '"[a-z]*(tailscale|zerotier|wireguard|easytier|vnt|cloudflar|vpntool)[a-z]*"' jsonrpc.go

# 2.4 前端命中(主战场 = Access 设置页)
grep -rEil 'tailscale|zerotier|wireguard|easytier|vnt|cloudflared|VpnTool|VpnConnectionStatus' ui/src
#   layout/components_setting/access/AccessContent.tsx —— Remote tabs(7个) + 各 tab 内容 + Log 弹窗
#   components/Header/VpnConnectionStatusCard.tsx + Header.tsx —— 顶栏状态卡
#   layout/core/bar_bottom/BottomBarPC.tsx / BottomBarMobile.tsx —— 底栏 VpnStatusButton
#   layout/index.pc.tsx / index.mobile.tsx —— updateVpnStates 5秒轮询 + RPC 事件回写 store
#   hooks/stores.ts —— useVpnStore(tailscale/zerotier 状态)
#   locales/zh.json,en.json —— 文案(可不动)
```

---

## 3. 必须保留的「同名陷阱」（删错会出事）

| 名字 | 在哪 | 为什么必须留 |
|---|---|---|
| **FRP(frpc)** | `vpn.go` 的 `rpc*Frpc`、`tools.go` 的 `frpc` spec、`config.FrpcAutoStart/FrpcToml` | 不在拆除清单，是要保留的穿透方式 |
| **cloudflare(NTP)** | `internal/timesync/http.go`(`cp.cloudflare.com`)、`ntp.go`(`time.cloudflare.com`) | 是对时/联网检测的公共服务，**与 Cloudflare Tunnel 无关**，删了影响时间同步 |
| **WebRTC 本地直连** | `webrtc.go`、`cloud.go` `handleSessionRequest`、`web.go` `/webrtc/*` | 远程控制的传输底座，删=app 报废 |
| **`CtrlResponse` / `CallCtrlAction`** | `native.go`(通用) | 音视频/显示/USB 共用；只有 `native_vpn.go` 的 `CallVpnCtrlAction` 是 vpn 专用可删 |
| **VpnTool 下载器** | `tools.go` 整套 + `getVpnTool*` RPC | 前端 **frp tab 复用**它，只能从 `vpnToolSpecs` 删掉 easytier/vnt/cloudflared，**留 frpc** |

---

## 4. 后端拆除模式（改完跑一次编译）

> 顺序无所谓，因为有跨文件引用，**一次性改完所有后端文件再编译**最省事。

1. **`vpn.go`**：删 6 个后端的全部 `type`/`rpc*` 函数 + `VpnUpdateDisplayState`/`HandleVpnDisplayUpdateMessage`；
   `initVPN()` 精简成只剩 frpc 自启动 + 子进程回收 goroutine（去掉 `waitVpnCtrlClientConnected()`）。
   因 frpc 与 cloudflared 在文件里交错，**最稳是整文件重写为「仅 frpc + 精简 initVPN」**；
   随之删掉只被 tailscale/zerotier 用的 `encoding/json` import。
2. **`native_vpn.go`**：**整文件删除**（`CallVpnCtrlAction`/`StartVpnCtrlSocketServer`/`handleVpnCtrlClient`/`ExtractAndRunVpnBin` 等 vpnctrl 子系统，仅服务 tailscale/zerotier）。
3. **`main.go`**：删 `StartVpnCtrlSocketServer()` 与 goroutine 里的 `ExtractAndRunVpnBin()` 调用（连同其 if-err 块）。`initVPN()` 调用保留。
4. **`tools.go`**：`vpnToolSpecs` 这个 map 删 easytier/vnt/cloudflared，**只留 frpc**。
   （`spec.Name=="vnt"` 之类的特判分支会变不可达但无害，可不删。）
5. **`config.go`**：删 6 个后端的字段（`TailScale*`/`ZeroTier*`/`Cloudflared*`/`Easytier*`/`Vnt*`/`Wireguard*`）、
   类型（`VntConfig`/`WireguardConfig`，`EasytierConfig` 原在 vpn.go）、默认值块里的对应行；**留 `Frpc*`**。
6. **`jsonrpc.go`**：在 RPC 注册 map 里删 6 个后端的方法行；
   **保留** frpc 5 个（`startFrpc/stopFrpc/getFrpcStatus/getFrpcToml/getFrpcLog`）和 `getVpnTool*` 8 个（frpc 要用）。

**Go 编译器特性（降风险）**：未使用的**包级函数/类型/常量不报错**，只有未使用的 **import / 局部变量**报错。
所以删 RPC 后即便残留个别辅助函数也能编译；但 import 要清干净。

**后端验证**：
```bash
export PATH="$HOME/sdk/go1.25.5/bin:$PATH"
GOOS=linux GOARCH=arm GOARM=7 go build -tags netgo -o /tmp/kvm_app_test cmd/main.go && echo OK
```

---

## 5. 前端拆除模式（改完 `npm run build:device` 当测试）

> `tsc` 是安全网：JSX 括号删错、引用悬空都会立刻报错。`tsconfig` 里 `noUnusedLocals:false`
> → **删了 UI 内容块后，残留的 handler/state 即便没人用也能编译**（见 §6 残留说明）。

主战场 **`AccessContent.tsx`**（Access 设置页，结构 = Local 区 + WebRTC Servers 区 + Remote 区 Tabs）：

1. **Remote Tabs 数组**（`[{id:"tailscale",...},...]`）→ 只留 `{id:"frp",label:"Frp"}`。
2. **6 个内容块**：每个是 `{activeTab === "xxx" && ( ... )}` 的并列兄弟节点，连续成片，
   **用 sed 按行号一次删**最快（删前 grep 确认边界，frp 块和 Frpc Log 弹窗要留）：
   ```bash
   # 例（行号每次不同！先 grep 'activeTab ===' 和 LogDialog title 定位）
   sed -i -e '<tailscale起>,<cloudflared止>d' -e '<非frp Log弹窗段>d' AccessContent.tsx
   ```
3. **收尾引用**：`activeTab` 默认值 `useState("tailscale")`→`"frp"`；`ManagedVpnTool` 类型→`"frpc"`；
   `managedTools`→`["frpc"]`；`tabToolMap` 只留 `frp:"frpc"`。
   **⚠️ 同时删「挂载时自动拉状态」的 `useEffect`（最易漏！漏了进 Access 页会弹一串报错）**：组件里有几处
   `useEffect(()=>{ getXxxConfig(); getXxxStatus(); }, [...])` 在挂载时**主动调**已删后端的 RPC
   （本例是 `getEasyTierStatus`/`getWireguardStatus`/`getVntStatus`/`getVntConfigFile` 及对应 config 三段 effect），
   后端没了 → 逐条 `Failed to get … status: Unknown error` toast 闪过。**必须删掉这些 effect。**
   定位：`grep -nE 'useEffect' AccessContent.tsx` 逐个看 body 是否调已删 getter；
   或 `grep -nE 'get(EasyTier|Wireguard|Vnt|Cloudflared)(Status|Config)\(\)' AccessContent.tsx` 找调用点。
   **区分**：只在按钮回调里触发的(如 Tailscale `loginTailScale`)、只定义从没被调用的(如 `getCloudflaredStatus`)**不报错**，
   属于 §6 的无害残留；只有**挂载 effect 里主动调**的才会弹错。`setInterval` 轮询若还含已删 tool 同样要清
   （本例只剩 frpc 安装任务轮询 `managedTools=["frpc"]`，已 OK）。
4. **Log 弹窗**：只留 `Frpc Log`，删 Cloudflare/EasyTier/WireGuard/Vnt 的 `<LogDialog>`。

状态展示（删可见 UI，inert 的 store 读取可留）：
5. **`Header.tsx`**：删两个 `<VpnConnectionStatusCard title="TailScale/ZeroTier">`。
6. **`BottomBarPC.tsx` / `BottomBarMobile.tsx`**：删两个 `<VpnStatusButton vpnState={tailScale/zeroTier...}>`。
7. **`index.pc.tsx` / `index.mobile.tsx`**：删 `updateVpnStates` 函数 + `useInterval(updateVpnStates,5000)` +
   另一处 RPC 通道 open 时的 `updateVpnStates()` 调用（**两处都要删**，否则会每 5 秒打已删 RPC）。
8. `hooks/stores.ts` 的 `useVpnStore`、`locales` 文案：可留（inert/未用，不影响编译）。

**前端验证**：`cd ui && npm run build:device`（exit 0 即过，产物在 `../static`）。

---

## 6. 已知「残留」（无害，可选再清）

`noUnusedLocals:false` 允许留下死代码。首次实施后 `AccessContent.tsx` 仍有 **~40+ 个「已定义但不再被调用」的 handler**
（如 `handleStartEasyTier`/`getCloudflaredStatus`，内含 `send("startVnt")` 等）及其 state，永不执行、能编译。
`tools.go` 有 `spec.Name=="vnt"` 不可达分支。这些**只在按钮回调/已删 UI 里才会触发**，无 UI 入口 → 永不执行、纯整洁度问题。
要彻底清：逐个删 `AccessContent.tsx` 里 `const handleXxx = useCallback(...)` / `const getXxx = useCallback(...)` 及其
`useState`，靠 `tsc` 报错驱动（删到不报错为止）。

> **⚠️ 但有一类残留不是无害的**：挂载时 `useEffect` 主动调的 getter（见 §5.3）会**真的执行并报错弹窗**，
> 那不算"可选再清"，而是**必须删**的拆除步骤。判据：看 getter 是否被某个 `useEffect`（依赖数组里有它）或 `setInterval` 引用——
> 被挂载 effect/轮询引用的 = 会执行 = 必删；只被 onClick 回调或根本没人引用的 = inert = 可留。
>
> 2026-06-20 首次实施时即漏了这三段 effect，部署后进 Access 页弹出 `Failed to get Vnt/EasyTier/WireGuard status` 才补删。

---

## 7. 整体验证 & 产物

```bash
cd ~/Documents/picokvm
export PATH="$HOME/sdk/go1.25.5/bin:$PATH"
make build_dev        # 前端 static/ 须已构建过；产出 bin/kvm_app
file bin/kvm_app      # 期望: ELF 32-bit ARM EABI5, statically linked（RV1106/ARMv7）
```
产物 `bin/kvm_app` 传到设备替换 `/userdata/picokvm/bin/kvm_app`（SSH/MTP）。

---

## 8. 同步上游后复用流程

```bash
cd ~/Documents/picokvm
git fetch upstream && git checkout luckfox && git merge upstream/luckfox   # 同步官方最新
git checkout -b strip-remote-vpn-<日期>                                     # 新拆除分支
# 按 §2 重新 grep 定位（官方可能新增/改名后端或挪动文件）→ §4 后端 → §5 前端 → §7 验证
```
注意：官方更新可能**新增**组网后端（如又加一个穿透工具）或**重构** vpn.go/AccessContent 结构，
所以每次都要先跑 §2 的 grep，别假设行号/结构不变。`vpnToolSpecs`(tools.go) 和 jsonrpc 注册表是发现「新增了什么」的最快入口。

## 9. 首次实施改动清单（参照）
`vpn.go`(重写仅frpc) / `native_vpn.go`(删) / `main.go` / `tools.go` / `config.go` / `jsonrpc.go`；
前端 `AccessContent.tsx` / `Header.tsx` / `BottomBarPC.tsx` / `BottomBarMobile.tsx` / `index.pc.tsx` / `index.mobile.tsx`。
合计 12 文件，净删约 2000 行。前后端编译均通过。
