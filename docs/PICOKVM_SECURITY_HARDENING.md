# Luckfox PicoKVM —— 安全加固（公网暴露场景）⭐ 同步上游后**最先执行**

> 适用工程：`~/Documents/picokvm`（见记忆 `picokvm-build-env`）。
> **本文是改动流程的「第一步」**，且是**每次同步官方新代码后第一件要做并复查的事**。
> 之后：第二步＝拆远程组网 [PICOKVM_STRIP_REMOTE_NET.md](PICOKVM_STRIP_REMOTE_NET.md)；第三步＝fail2ban [PICOKVM_FAIL2BAN_LOGIN.md](PICOKVM_FAIL2BAN_LOGIN.md)；
> 第四步＝USB [PICOKVM_USB_STORAGE.md](PICOKVM_USB_STORAGE.md)；第五步＝键盘 [PICOKVM_KEYBOARD_RIGHT_MODIFIERS.md](PICOKVM_KEYBOARD_RIGHT_MODIFIERS.md)；第六步/最后＝部署 [PICOKVM_DEPLOY_DEVICE.md](PICOKVM_DEPLOY_DEVICE.md)。
> 首次实施并实机验证通过：2026-06-20。

---

## 0. 威胁模型（为什么必须加固）
设备的 web 端口经路由器转发到**公网**（TLS 自带证书 + fail2ban 已上）。**登录进来 = 一个可 sudo 的 Linux + 被控主机键鼠/视频**，是高价值目标。因此对**任何公网可达、且无鉴权 / 弱鉴权 / 可被跨站借用凭据**的入口都要清零。

> ⚠️ 官方每次更新都可能重新引入这些隐患（pprof、`InsecureSkipVerify`、Cookie 标志、新端口）。**升级后先按 §2 清单逐条 grep 复查。**

---

## 1. 本次加固清单（2026-06-20，已实机验证）

| # | 问题 | 文件:位置 | 处理 |
|---|---|---|---|
| 1 | **公网无鉴权 pprof**：`net/http/pprof` 被 import 后 `r.Any("/debug/pprof/*any", gin.WrapH(http.DefaultServeMux))` 挂根路由，公网可打 `/debug/pprof/profile`(30s CPU=DoS)、`heap`(泄露内存中令牌/口令哈希) | `web.go` setupRouter | **删掉那行**。pprof 只保留鉴权后的 `/developer/pprof`。删后该路径落 SPA 兜底（返回 index.html）即正常 |
| 2 | **/metrics 公网无鉴权**，泄露内部指标 | `web.go` `r.GET("/metrics",...)` | 加 `privateIPOnly()` 中间件（复用 `ratelimit.go` 的 `isWhitelistedIP`，回环+RFC1918 放行，其余 404） |
| 3 | **WebSocket 关闭 Origin 校验（CSWSH）**：`InsecureSkipVerify:true`，配合 Cookie 认证→恶意网页可借受害者 Cookie 连 `/terminal/ws` 拿设备 shell | `web.go`(信令)、`terminal.go`、`serial.go` 的 `websocket.Accept` | 去掉 `InsecureSkipVerify` → `coder/websocket` 默认做同源校验（Origin 主机须＝Host）。端口直转 Host 透传，正常访问不受影响 |
| 4 | **authToken Cookie 弱**：`Secure=false`、无 `SameSite` | `web.go` 多处 `SetCookie` | 统一走 `setAuthCookie()`：`HttpOnly` + `SameSite=Strict`（挡 CSRF/CSWSH 携带 Cookie）+ `Secure=c.Request.TLS!=nil`（HTTPS 才置 Secure，LAN http 不受影响） |
| 5 | **httpSessionId Cookie `HttpOnly=false`**（JS 可读，XSS 可窃） | `web.go` handleRpcRequest | 改 `HttpOnly=true` + 动态 Secure + SameSite=Strict。**前端用 `sessionStorage`+`X-Session-ID` 头、不读此 cookie**，故安全无影响 |
| 6 | **authToken 比较非常量时间** | `web.go` protectedMiddleware | `subtle.ConstantTimeCompare` |
| 7 | **MCP 空 APIKey 时不挂鉴权（裸奔）**；key 用 `EqualFold`（大小写不敏感+非常量时间） | `mcp.go` | 始终挂鉴权；空 key→拒绝非本机；`subtle.ConstantTimeCompare` |
| 8 | **API/MCP（8080/8081）监听全网卡**，局域网可达 | `api.go`/`mcp.go` addr | 改绑 `127.0.0.1:%d`（仅本机自动化）。⚠️ 若要局域网调用，改回 `:%d` 并确保 APIKey 已配 + 端口**不转发到公网** |
| 9 | **缺安全响应头** | `web.go` setupRouter | 全局加 `X-Content-Type-Options:nosniff`、`X-Frame-Options:SAMEORIGIN`、`Referrer-Policy:no-referrer`；HTTPS 连接加 `HSTS` |
| 10 | API key 比较 `EqualFold` | `api.go` apiKeyAuthMiddleware | `subtle.ConstantTimeCompare` |

**配置侧（非代码，部署时确认）**：
- 路由器**只转发 web 端口**（设备 TLS :443），**绝不转发 8080/8081**。
- `LocalAuthMode` **绝不能是 `noPassword`**——那样 `protectedMiddleware` 全放行（公网=完全沦陷）。`handleSetup` 已防重复接管，但**全新/刷机后要第一时间设密码**再暴露。

**保持不变（已是好的）**：bcrypt 口令、登录+basicAuth 两条路径接 fail2ban + `SetTrustedProxies(nil)`（防 XFF 伪造）、authToken 为随机 UUIDv4、下载用 `sanitizeFilename` 防穿越、`exec.Command` 固定参不经 shell 无注入。

---

## 2. 同步上游后的复查命令（每次升级先跑）
```bash
cd ~/Documents/picokvm
# 1) 根路由是否又冒出无鉴权 pprof（应只在 /developer/ 组里见到 pprof）
grep -nE 'debug/pprof|DefaultServeMux' web.go
# 2) WS 是否又被设 InsecureSkipVerify（应为空）
grep -rnE 'InsecureSkipVerify' --include=*.go
# 3) Cookie 是否又退回 Secure=false/无 SameSite（authToken 应只经 setAuthCookie）
grep -nE 'SetCookie\(' web.go
# 4) /metrics 是否仍有 privateIPOnly 保护
grep -nE '/metrics' web.go
# 5) API/MCP 监听地址是否仍绑回环
grep -rnE 'fmt.Sprintf\("127.0.0.1:%d|fmt.Sprintf\(":%d' api.go mcp.go
# 6) MCP 空 key 是否仍拒绝（不得回到 if APIKey!="" 才挂鉴权）
grep -nE 'expectedKey == ""|APIKey != ""' mcp.go
# 7) 是否仍 SetTrustedProxies(nil)
grep -nE 'SetTrustedProxies' web.go
```
对照 §1 表逐条恢复后再 `make build_dev`（OTA 配方见 [PICOKVM_DEPLOY_DEVICE.md](PICOKVM_DEPLOY_DEVICE.md)）。

---

## 3. 实机验证（部署后）
```bash
DEV=<DEVICE_IP>
curl -s -k -o /dev/null -w '%{http_code}\n' http://$DEV/debug/pprof/heap   # 应=200 但内容是 index.html(SPA 兜底)，非 heap dump
curl -s -k http://$DEV/metrics | head -1                                   # LAN(白名单)可见 metrics；公网应 404
curl -s -k -I http://$DEV/ | grep -iE 'X-Frame-Options|X-Content-Type'     # 安全头在
curl -s -o /dev/null -w '%{http_code}\n' --max-time 4 http://$DEV:8081/sse # LAN 连 8081 应=000(已绑 localhost)
# WS/SameSite：浏览器刷新页面，确认视频(WebRTC 信令 WS)、终端、串口正常 = 同源校验未误伤
```
判据：pprof 中和、metrics 仅私网、安全头在、8080/8081 LAN 不可达、浏览器功能正常。

---

## 4. 还可做（本次未做，按需）
- 设备 :80 明文服务若不需要可关，只留 :443（减少明文面）。
- `/developer/` pprof 即便有 basic auth，不用时可整段去掉。
- CSP（Content-Security-Policy）目前未加，前端较复杂，需测试别误伤。
