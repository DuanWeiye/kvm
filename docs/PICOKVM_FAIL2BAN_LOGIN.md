# Luckfox PicoKVM —— 登录 fail2ban（2 次失败永封 + 公开封禁列表）

> 适用工程：`~/Documents/picokvm`（fork 自 `LuckfoxTECH/kvm`，详见记忆 `picokvm-build-env` 与
> 同目录 [PICOKVM_STRIP_REMOTE_NET.md](PICOKVM_STRIP_REMOTE_NET.md)）。
> **本文是「同步官方新代码后的第二步」**：第一步＝按 STRIP_REMOTE_NET 拆远程组网组件；第二步＝按本文重做 fail2ban。
> 首次实施：2026-06-20（与拆除工作同在分支 `strip-remote-vpn`，未 commit）。

---

## 0. 需求与一句话思路

需求：密码**失败 2 次→永久封禁**该 IP；封禁列表在**登录页公开展示**（IP + 封禁时间，无需登录）；
**内存态即可，重启清空**（不做 TF 卡持久化）；局域网/私网 IP 永不封禁。

一句话思路：**工程已自带一个限流层 `ratelimit.go`**，且登录的两条路径都走它——所以**不新增系统，直接把这层从「5 次/10 分钟临时封」改成「2 次永久封」并加白名单 + 公开列表端点**即可，改动面极小。

---

## 1. 关键前提（动手前先 grep 确认仍成立）

- 限流层文件：`ratelimit.go`（`CheckRateLimit` / `RecordFailure` / `RecordSuccess` / `ipRateLimits`）。
- **两条登录路径都已接这层**（改一层即全覆盖）：
  - `web.go` `handleLogin`（本地密码登录 `/auth/login-local`）
  - `web.go` `basicAuthProtectedMiddleware`（开发者/HTTP Basic Auth）
- 取来源 IP：`ip := c.ClientIP()`（gin）。
- 登录页前端：`ui/src/routes/login-local.tsx`（React Router route，含 `loader`/`action`）。
- 公开端点落点：`web.go` setupRouter 里 `r.POST("/auth/login-local", handleLogin)` 旁边（`protected` 组之外＝免登录）。

```bash
cd ~/Documents/picokvm
grep -nE 'CheckRateLimit|RecordFailure|RecordSuccess' ratelimit.go web.go   # 确认 API 与调用点
grep -nE 'login-local|ClientIP|protected :?= r.Group' web.go                # 确认路由/IP 获取/保护组
ls ui/src/routes/login-local.tsx                                            # 确认登录页位置
```

> ⚠️ 官方可能改 `ratelimit.go` 的签名、把限流挪走、或重构登录页。每次同步后先跑上面 grep，按实际情况套用下面的改法，别假设行号不变。

---

## 2. 后端改法

### 2.1 `ratelimit.go`（核心，整文件按下述模型重写）
- 模型从「5 次失败→10 分钟翻倍临时封」改为「**2 次失败→永久封（内存态，重启清空）**」。
- `RateLimitInfo` 用 `Failures int` + `BannedAt time.Time`（非零＝已永封）+ `LastSeen`；删掉旧的 `BlockUntil/PenaltySeconds/BasePenalty`。
- 常量 `MaxFailures = 2`。
- **白名单**：`whitelistedNets`＝`127.0.0.0/8`、`::1/128`、`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`（**含常见私网网段**）；`isWhitelistedIP()` 用 `net.ParseCIDR`/`IPNet.Contains`。白名单 IP 在 `RecordFailure`/`CheckRateLimit` 里直接放行、永不计数。
- API：
  - `CheckRateLimit(ip string) bool`（**签名简化为返回 bool**：白名单或未封→true）。
  - `RecordFailure(ip)`：非白名单累加，达 2 次置 `BannedAt=now`。
  - `RecordSuccess(ip)`：`delete` 计数（被封 IP 走不到这里，不会被解封）。
  - 新增 `ListBannedIPs() []BannedIP`（`BannedIP{IP string; BannedAt time.Time}`，带 `json` tag）。
- **清理 goroutine 跳过已封禁条目**（`if !info.BannedAt.IsZero() { continue }`），否则 24h 空闲会自动解封，违背「永封」。

### 2.2 `web.go`
- 两处调用点（`handleLogin`、`basicAuthProtectedMiddleware`）把
  `if allowed, wait := CheckRateLimit(ip); !allowed { ...try again in %s... }`
  改成 `if !CheckRateLimit(ip) { ...HTTP 403 + "Your IP has been banned..." }`。
  （顺带去掉对 `wait`/`fmt.Sprintf` 的依赖；`fmt`/`time` 在 web.go 别处仍用，不必删 import——靠编译确认。）
- 公开端点 + 处理函数：
  ```go
  r.GET("/auth/banned", handleListBannedIPs)   // 放在 /auth/login-local 旁（免登录区）

  func handleListBannedIPs(c *gin.Context) {
      c.JSON(http.StatusOK, gin.H{"banned": ListBannedIPs()})
  }
  ```
- **【安全必做】禁止伪造来源 IP**：`setupRouter()` 里 `gin.Default()` 之后加 `_ = r.SetTrustedProxies(nil)`。
  否则 gin 默认信任任意客户端的 `X-Forwarded-For`，攻击者每次换一个随机 XFF 即可让失败计数永远凑不满
  → **fail2ban 被绕过、暴力破解照跑**；或把 XFF 伪造成内网 IP → 落进白名单免疫。设备直接监听 :80/:443，
  用 TCP 对端真实 IP 才正确。**若日后置于会改写真实 IP 的反向代理之后**，改为 `SetTrustedProxies([]string{"<代理CIDR>"})` 并确保代理透传真实客户端 IP。

---

## 3. 前端改法（`ui/src/routes/login-local.tsx`）
- 在登录表单（`</Fieldset>`）下方加一个自包含组件 `<BannedList />`。
- `BannedList`：`useEffect` 里用 `api.GET(`${DEVICE_API}/auth/banned`)` 拉取，`setInterval` 每 5 秒刷新，
  渲染「IP — 封禁时间」；空列表显示 `None`。时间用 `toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"})` 按 JST 展示。
- `react` import 加 `useEffect`；`api`、`DEVICE_API` 该文件已 import。

---

## 4. 测试与验证
- **Go 单测** `ratelimit_test.go`（host 可直接跑，纯逻辑、不依赖设备）：
  - 白名单 LAN IP（192.168.x.x）多次失败仍不封、不入列表；
  - 公网 IP 失败 2 次→封、入列表且带时间；
  - 清理后被封条目仍在；未封的空闲计数被清理。
- 验证命令：
  ```bash
  export PATH="$HOME/sdk/go1.25.5/bin:$PATH"
  go test -run 'Ban|Whitelist|Cleanup|Unbanned' -v .         # 单测(host)
  GOOS=linux GOARCH=arm GOARM=7 go build -tags netgo -o /tmp/t cmd/main.go   # 交叉编译
  cd ui && npm run build:device                              # 前端
  cd .. && make build_dev                                    # 整体→bin/kvm_app
  ```

---

## 5. 边界与已知取舍
- 「永封」实为「封到重启」（内存态，按需求接受）。断电/重启即全部解封——也是误封自救手段。
- 封禁只挡**登录校验**（两条 auth 路径）；被封 IP 仍能打开静态页面和看公开封禁列表（符合「列表免登录可见」）。如需连访问都挡，那是防火墙层（见工程 `firewall.go`/iptables），不在本方案。
- 阈值「2 次」是 `MaxFailures` 常量，要调改一处即可。
- 白名单网段集中在 `whitelistedNets`，要加/改网段改这里。
- **来源 IP 与 FRP 的局限**：fail2ban 按 `c.ClientIP()`（TCP 对端）计数。**经 FRP 隧道**进来的外网流量，后端看到的是隧道本地端点（常为 `127.0.0.1`，在白名单内）→ 这类外网攻击者**不会被区分/封禁**、也不会出现在公开列表。fail2ban 对"直连/局域网暴露、或能透传真实 IP 的代理"最有意义；纯 FRP 暴露想封真实外网 IP 需 frp proxy-protocol 支持并解析，超出本方案。

---

## 6. 同步上游后复用流程（本文＝第二步）
```bash
cd ~/Documents/picokvm
git fetch upstream && git checkout luckfox && git merge upstream/luckfox   # 同步官方
# 第一步：按 PICOKVM_STRIP_REMOTE_NET.md 拆远程组网组件
# 第二步：按本文 §1 grep 确认 → §2 后端 → §3 前端 → §4 验证
```
官方若重构了 `ratelimit.go`/登录中间件/登录页，按 §1 的 grep 重新定位锚点再套用；
若官方新增了别的登录入口，记得确认它是否也走 `CheckRateLimit`（不走则需补挂）。

## 7. 首次实施改动清单（参照）
`ratelimit.go`(重写) + `ratelimit_test.go`(新增) + `web.go`(2 调用点改文案/403 + 公开端点与 handler) +
`ui/src/routes/login-local.tsx`(BannedList 组件)。验证：单测 4/4 通过，交叉编译/前端/`make build_dev` 均通过。
