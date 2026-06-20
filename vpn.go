package kvm

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
)

// 说明：原本这里还集中实现了 TailScale / ZeroTier / WireGuard / EasyTier / Vnt /
// Cloudflare(Tunnel) 等远程组网/穿透后端，已按需求整体移除。
// 仅保留 FRP(frpc) 内网穿透，以及精简后的自启动逻辑 initVPN。

type FrpcStatus struct {
	Running bool `json:"running"`
}

var (
	frpcTomlPath = "/userdata/frpc/frpc.toml"
	frpcLogPath  = "/tmp/frpc.log"
)

func frpcRunning() bool {
	cmd := exec.Command("pgrep", "-x", "frpc")
	return cmd.Run() == nil
}

func rpcGetFrpcLog() (string, error) {
	f, err := os.Open(frpcLogPath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("frpc log file not exist")
		}
		return "", err
	}
	defer f.Close()

	const want = 30
	lines := make([]string, 0, want+10)
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		lines = append(lines, sc.Text())
		if len(lines) > want {
			lines = lines[1:]
		}
	}
	if err := sc.Err(); err != nil {
		return "", err
	}

	var buf []byte
	for _, l := range lines {
		buf = append(buf, l...)
		buf = append(buf, '\n')
	}
	return string(buf), nil
}

func rpcGetFrpcToml() (string, error) {
	return config.FrpcToml, nil
}

func rpcStartFrpc(frpcToml string) error {
	if frpcRunning() {
		_ = exec.Command("pkill", "-x", "frpc").Run()
	}

	if frpcToml != "" {
		_ = os.MkdirAll(filepath.Dir(frpcTomlPath), 0700)
		if err := os.WriteFile(frpcTomlPath, []byte(frpcToml), 0600); err != nil {
			return err
		}
		cmd := exec.Command(resolveVpnToolBinary("frpc", "frpc"), "-c", frpcTomlPath)
		cmd.Stdout = nil
		cmd.Stderr = nil
		logFile, err := os.OpenFile(frpcLogPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
		if err != nil {
			return err
		}
		defer logFile.Close()
		cmd.Stdout = logFile
		cmd.Stderr = logFile

		cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}

		if err := cmd.Start(); err != nil {
			return fmt.Errorf("start frpc failed: %w", err)
		} else {
			config.FrpcAutoStart = true
			config.FrpcToml = frpcToml
			if err := SaveConfig(); err != nil {
				return fmt.Errorf("failed to save config: %w", err)
			}
		}
	} else {
		return fmt.Errorf("frpcToml is empty")
	}

	return nil
}

func rpcStopFrpc() error {
	if frpcRunning() {
		err := exec.Command("pkill", "-x", "frpc").Run()
		if err != nil {
			return fmt.Errorf("failed to stop frpc: %w", err)
		}
	}

	config.FrpcAutoStart = false
	err := SaveConfig()
	if err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}
	return nil
}

func rpcGetFrpcStatus() (FrpcStatus, error) {
	return FrpcStatus{Running: frpcRunning()}, nil
}

func initVPN() {
	go func() {
		for {
			if !networkState.IsOnline() {
				vpnLogger.Warn().Msg("waiting for network to be online, will retry in 3 seconds")
				time.Sleep(3 * time.Second)
				continue
			} else {
				break
			}
		}

		if config.FrpcAutoStart && config.FrpcToml != "" {
			if err := rpcStartFrpc(config.FrpcToml); err != nil {
				vpnLogger.Error().Err(err).Msg("Failed to auto start frpc")
			}
		}
	}()

	// 回收子进程（如 frpc）退出后的僵尸进程
	go func() {
		for {
			var status syscall.WaitStatus
			var rusage syscall.Rusage
			pid, err := syscall.Wait4(-1, &status, syscall.WNOHANG, &rusage)
			if pid <= 0 || err != nil {
				time.Sleep(5 * time.Second)
			}
		}
	}()
}
