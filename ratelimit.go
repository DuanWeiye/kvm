package kvm

import (
	"net"
	"sync"
	"time"
)

// RateLimitInfo 记录单个 IP 的登录失败计数与封禁状态。
type RateLimitInfo struct {
	Failures int
	BannedAt time.Time // 非零 = 已永久封禁（内存态，直到设备重启）
	LastSeen time.Time
}

// BannedIP 用于对外（公开端点/登录页）展示封禁记录。
type BannedIP struct {
	IP       string    `json:"ip"`
	BannedAt time.Time `json:"bannedAt"`
}

var (
	ipRateLimits   = make(map[string]*RateLimitInfo)
	ipRateLimitsMu sync.Mutex
)

const (
	// MaxFailures 次密码失败后永久封禁该 IP（直到设备重启）。
	MaxFailures      = 2
	CleanupInterval  = 1 * time.Hour
	RecordExpiration = 24 * time.Hour
)

// whitelistedNets 是局域网/私网白名单：来自这些网段的来源 IP 永不计数、永不封禁，
// 避免管理员从内网误触后把自己锁死。覆盖常见私网网段。
var whitelistedNets = parseCIDRs([]string{
	"127.0.0.0/8",    // IPv4 回环
	"::1/128",        // IPv6 回环
	"10.0.0.0/8",     // RFC1918
	"172.16.0.0/12",  // RFC1918
	"192.168.0.0/16", // RFC1918
})

func parseCIDRs(cidrs []string) []*net.IPNet {
	nets := make([]*net.IPNet, 0, len(cidrs))
	for _, c := range cidrs {
		if _, n, err := net.ParseCIDR(c); err == nil {
			nets = append(nets, n)
		}
	}
	return nets
}

// isWhitelistedIP 判断该来源 IP 是否在局域网/私网白名单内。
func isWhitelistedIP(ip string) bool {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return false
	}
	for _, n := range whitelistedNets {
		if n.Contains(parsed) {
			return true
		}
	}
	return false
}

func init() {
	go func() {
		for {
			time.Sleep(CleanupInterval)
			cleanupRateLimits()
		}
	}()
}

func cleanupRateLimits() {
	ipRateLimitsMu.Lock()
	defer ipRateLimitsMu.Unlock()

	now := time.Now()
	for ip, info := range ipRateLimits {
		// 已封禁的条目不清理：保持永久封禁直到重启（否则 24h 空闲会自动解封）。
		if !info.BannedAt.IsZero() {
			continue
		}
		if now.Sub(info.LastSeen) > RecordExpiration {
			delete(ipRateLimits, ip)
		}
	}
}

// CheckRateLimit 返回该 IP 当前是否允许尝试登录。白名单 IP 始终允许。
func CheckRateLimit(ip string) bool {
	if isWhitelistedIP(ip) {
		return true
	}

	ipRateLimitsMu.Lock()
	defer ipRateLimitsMu.Unlock()

	info, exists := ipRateLimits[ip]
	if !exists {
		return true
	}
	return info.BannedAt.IsZero()
}

// RecordFailure 记录一次失败的登录尝试；累计达到 MaxFailures 即永久封禁（白名单 IP 除外）。
func RecordFailure(ip string) {
	if isWhitelistedIP(ip) {
		return
	}

	ipRateLimitsMu.Lock()
	defer ipRateLimitsMu.Unlock()

	info, exists := ipRateLimits[ip]
	if !exists {
		info = &RateLimitInfo{}
		ipRateLimits[ip] = info
	}

	info.LastSeen = time.Now()
	if !info.BannedAt.IsZero() {
		return // 已封禁，无需再累加
	}

	info.Failures++
	if info.Failures >= MaxFailures {
		info.BannedAt = time.Now()
	}
}

// RecordSuccess 在登录成功后清除该 IP 的失败计数。
// 注意：被封禁的 IP 在 CheckRateLimit 处即被拦截、走不到密码校验，因此不会经此解封。
func RecordSuccess(ip string) {
	ipRateLimitsMu.Lock()
	defer ipRateLimitsMu.Unlock()
	delete(ipRateLimits, ip)
}

// ListBannedIPs 返回当前被永久封禁的 IP 及其封禁时间（供公开端点/登录页展示）。
func ListBannedIPs() []BannedIP {
	ipRateLimitsMu.Lock()
	defer ipRateLimitsMu.Unlock()

	out := make([]BannedIP, 0)
	for ip, info := range ipRateLimits {
		if !info.BannedAt.IsZero() {
			out = append(out, BannedIP{IP: ip, BannedAt: info.BannedAt})
		}
	}
	return out
}
