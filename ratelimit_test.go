package kvm

import (
	"testing"
	"time"
)

// resetRateLimits 清空全局封禁状态，保证用例之间相互独立。
func resetRateLimits() {
	ipRateLimitsMu.Lock()
	ipRateLimits = make(map[string]*RateLimitInfo)
	ipRateLimitsMu.Unlock()
}

func TestWhitelistedLANNeverBanned(t *testing.T) {
	resetRateLimits()
	ip := "192.168.1.50" // 私网示例 IP（命中白名单）
	for i := 0; i < 5; i++ {
		RecordFailure(ip)
	}
	if !CheckRateLimit(ip) {
		t.Fatalf("白名单局域网 IP 不应被封禁")
	}
	if len(ListBannedIPs()) != 0 {
		t.Fatalf("白名单 IP 不应出现在封禁列表，实际 %d 条", len(ListBannedIPs()))
	}
}

func TestBanAfterTwoFailures(t *testing.T) {
	resetRateLimits()
	ip := "203.0.113.7" // 公网示例地址
	RecordFailure(ip)
	if !CheckRateLimit(ip) {
		t.Fatalf("失败 1 次后仍应允许登录")
	}
	RecordFailure(ip)
	if CheckRateLimit(ip) {
		t.Fatalf("失败 2 次后应被永久封禁")
	}
	bans := ListBannedIPs()
	if len(bans) != 1 || bans[0].IP != ip {
		t.Fatalf("封禁列表应仅含 %s，实际 %+v", ip, bans)
	}
	if bans[0].BannedAt.IsZero() {
		t.Fatalf("封禁记录应带有封禁时间")
	}
}

func TestCleanupKeepsBanned(t *testing.T) {
	resetRateLimits()
	ip := "203.0.113.8"
	RecordFailure(ip)
	RecordFailure(ip)

	// 模拟该 IP 已 48 小时无活动
	ipRateLimitsMu.Lock()
	ipRateLimits[ip].LastSeen = time.Now().Add(-48 * time.Hour)
	ipRateLimitsMu.Unlock()

	cleanupRateLimits()

	if CheckRateLimit(ip) {
		t.Fatalf("被封禁 IP 必须在清理后仍保持封禁（直到重启）")
	}
}

func TestUnbannedIPCleanedUp(t *testing.T) {
	resetRateLimits()
	ip := "203.0.113.9"
	RecordFailure(ip) // 仅 1 次，未封禁

	ipRateLimitsMu.Lock()
	ipRateLimits[ip].LastSeen = time.Now().Add(-48 * time.Hour)
	ipRateLimitsMu.Unlock()

	cleanupRateLimits()

	ipRateLimitsMu.Lock()
	_, exists := ipRateLimits[ip]
	ipRateLimitsMu.Unlock()
	if exists {
		t.Fatalf("未封禁且久未活动的计数条目应被清理")
	}
}
