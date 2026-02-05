package kvm

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"kvm/internal/logging"
	"kvm/internal/network"
	"kvm/internal/usbgadget"
)

type WakeOnLanDevice struct {
	Name       string `json:"name"`
	MacAddress string `json:"macAddress"`
}

// Constants for keyboard macro limits
const (
	MaxMacrosPerDevice = 25
	MaxStepsPerMacro   = 10
	MaxKeysPerStep     = 10
	MinStepDelay       = 50
	MaxStepDelay       = 2000
)

type KeyboardMacroStep struct {
	Keys      []string `json:"keys"`
	Modifiers []string `json:"modifiers"`
	Delay     int      `json:"delay"`
}

func (s *KeyboardMacroStep) Validate() error {
	if len(s.Keys) > MaxKeysPerStep {
		return fmt.Errorf("too many keys in step (max %d)", MaxKeysPerStep)
	}

	if s.Delay < MinStepDelay {
		s.Delay = MinStepDelay
	} else if s.Delay > MaxStepDelay {
		s.Delay = MaxStepDelay
	}

	return nil
}

type KeyboardMacro struct {
	ID        string              `json:"id"`
	Name      string              `json:"name"`
	Steps     []KeyboardMacroStep `json:"steps"`
	SortOrder int                 `json:"sortOrder,omitempty"`
}

func (m *KeyboardMacro) Validate() error {
	if m.Name == "" {
		return fmt.Errorf("macro name cannot be empty")
	}

	if len(m.Steps) == 0 {
		return fmt.Errorf("macro must have at least one step")
	}

	if len(m.Steps) > MaxStepsPerMacro {
		return fmt.Errorf("too many steps in macro (max %d)", MaxStepsPerMacro)
	}

	for i := range m.Steps {
		if err := m.Steps[i].Validate(); err != nil {
			return fmt.Errorf("invalid step %d: %w", i+1, err)
		}
	}

	return nil
}

type Config struct {
	STUN                 string                 `json:"stun"`
	JigglerEnabled       bool                   `json:"jiggler_enabled"`
	AutoUpdateEnabled    bool                   `json:"auto_update_enabled"`
	IncludePreRelease    bool                   `json:"include_pre_release"`
	HashedPassword       string                 `json:"hashed_password"`
	LocalAuthToken       string                 `json:"local_auth_token"`
	LocalAuthMode        string                 `json:"localAuthMode"` //TODO: fix it with migration
	LocalLoopbackOnly    bool                   `json:"local_loopback_only"`
	WakeOnLanDevices     []WakeOnLanDevice      `json:"wake_on_lan_devices"`
	KeyboardMacros       []KeyboardMacro        `json:"keyboard_macros"`
	KeyboardLayout       string                 `json:"keyboard_layout"`
	EdidString           string                 `json:"hdmi_edid_string"`
	ForceHpd             bool                   `json:"force_hpd"` // 强制输出EDID
	ActiveExtension      string                 `json:"active_extension"`
	DisplayRotation      string                 `json:"display_rotation"`
	DisplayMaxBrightness int                    `json:"display_max_brightness"`
	DisplayDimAfterSec   int                    `json:"display_dim_after_sec"`
	DisplayOffAfterSec   int                    `json:"display_off_after_sec"`
	TLSMode              string                 `json:"tls_mode"` // options: "self-signed", "user-defined", ""
	UsbConfig            *usbgadget.Config      `json:"usb_config"`
	UsbDevices           *usbgadget.Devices     `json:"usb_devices"`
	NetworkConfig        *network.NetworkConfig `json:"network_config"`
	AppliedNetworkConfig *network.NetworkConfig `json:"applied_network_config,omitempty"`
	DefaultLogLevel      string                 `json:"default_log_level"`
	TailScaleAutoStart   bool                   `json:"tailscale_autostart"`
	TailScaleXEdge       bool                   `json:"tailscale_xedge"`
	ZeroTierNetworkID    string                 `json:"zerotier_network_id"`
	ZeroTierAutoStart    bool                   `json:"zerotier_autostart"`
	FrpcAutoStart        bool                   `json:"frpc_autostart"`
	FrpcToml             string                 `json:"frpc_toml"`
	CloudflaredAutoStart bool                   `json:"cloudflared_autostart"`
	CloudflaredToken     string                 `json:"cloudflared_token"`
	IO0Status            bool                   `json:"io0_status"`
	IO1Status            bool                   `json:"io1_status"`
	AudioMode            string                 `json:"audio_mode"`
	TimeZone             string                 `json:"time_zone"`
	LEDGreenMode         string                 `json:"led_green_mode"`
	LEDYellowMode        string                 `json:"led_yellow_mode"`
	AutoMountSystemInfo  bool                   `json:"auto_mount_system_info_img"`
	EasytierAutoStart    bool                   `json:"easytier_autostart"`
	EasytierConfig       EasytierConfig         `json:"easytier_config"`
	VntAutoStart         bool                   `json:"vnt_autostart"`
	VntConfig            VntConfig              `json:"vnt_config"`
	WireguardAutoStart   bool                   `json:"wireguard_autostart"`
	WireguardConfig      WireguardConfig        `json:"wireguard_config"`
	NpuAppEnabled        bool                   `json:"npu_app_enabled"`
}

type VntConfig struct {
	Token      string `json:"token"`
	DeviceId   string `json:"device_id"`
	Name       string `json:"name"`
	ServerAddr string `json:"server_addr"`
	ConfigMode string `json:"config_mode"` // "params" or "file"
	ConfigFile string `json:"config_file"`
	Model      string `json:"model"`
	Password   string `json:"password"`
}

type WireguardConfig struct {
	NetworkName string `json:"network_name"`
	ConfigFile  string `json:"config_file"`
}

const configPath = "/userdata/kvm_config.json"
const sdConfigPath = "/mnt/sdcard/kvm_config.json"

var defaultConfig = &Config{
	STUN:                 "stun:stun.l.google.com:19302",
	AutoUpdateEnabled:    false, // Set a default value
	ActiveExtension:      "",
	KeyboardMacros:       []KeyboardMacro{},
	DisplayRotation:      "180",
	TimeZone:             "UTC-8",
	KeyboardLayout:       "en_US",
	DisplayMaxBrightness: 64,
	DisplayDimAfterSec:   120,  // 2 minutes
	DisplayOffAfterSec:   1800, // 30 minutes
	TLSMode:              "",
	ForceHpd:             false, // 默认不强制输出EDID
	UsbConfig: &usbgadget.Config{
		VendorId:     "0x1d6b", //The Linux Foundation
		ProductId:    "0x0104", //Multifunction Composite Gadget
		SerialNumber: "",
		Manufacturer: "KVM",
		Product:      "USB Emulation Device",
	},
	UsbDevices: &usbgadget.Devices{
		AbsoluteMouse: true,
		RelativeMouse: true,
		Keyboard:      true,
		MassStorage:   true,
		Audio:         false, //At any given time, only one of Audio and Mtp can be set to true
		Mtp:           false,
	},
	NetworkConfig:        &network.NetworkConfig{},
	AppliedNetworkConfig: nil,
	DefaultLogLevel:      "INFO",
	ZeroTierAutoStart:    false,
	TailScaleAutoStart:   false,
	TailScaleXEdge:       false,
	FrpcAutoStart:        false,
	CloudflaredAutoStart: false,
	IO0Status:            false,
	IO1Status:            false,
	AudioMode:            "disabled",
	LEDGreenMode:         "network-rx",
	LEDYellowMode:        "kernel-activity",
	AutoMountSystemInfo:  true,
	WireguardAutoStart:   false,
	NpuAppEnabled:        false,
}

var (
	config     *Config
	configLock = &sync.Mutex{}
)

func LoadConfig() {
	configLock.Lock()
	defer configLock.Unlock()

	if config != nil {
		logger.Debug().Msg("config already loaded, skipping")
		return
	}

	// load the default config
	if defaultConfig.UsbConfig.SerialNumber == "" {
		serialNumber, err := extractSerialNumber()
		if err != nil {
			logger.Warn().Err(err).Msg("failed to extract serial number")
		} else {
			defaultConfig.UsbConfig.SerialNumber = serialNumber
		}
	}
	loadedConfig := *defaultConfig
	config = &loadedConfig

	file, err := os.Open(configPath)
	if err != nil {
		logger.Debug().Msg("default config file doesn't exist, using default")
		return
	}
	defer file.Close()

	// load and merge the default config with the user config
	if err := json.NewDecoder(file).Decode(&loadedConfig); err != nil {
		logger.Warn().Err(err).Msg("config file JSON parsing failed")
		os.Remove(configPath)
		if _, err := os.Stat(sdConfigPath); err == nil {
			os.Remove(sdConfigPath)
		}
		return
	}

	// merge the user config with the default config
	if loadedConfig.UsbConfig == nil {
		loadedConfig.UsbConfig = defaultConfig.UsbConfig
	}

	if loadedConfig.UsbDevices == nil {
		loadedConfig.UsbDevices = defaultConfig.UsbDevices
	}

	if loadedConfig.NetworkConfig == nil {
		loadedConfig.NetworkConfig = defaultConfig.NetworkConfig
	}

	config = &loadedConfig

	logging.GetRootLogger().UpdateLogLevel(config.DefaultLogLevel)

	logger.Info().Str("path", configPath).Msg("config loaded")
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer func() {
		if cerr := out.Close(); cerr != nil && err == nil {
			err = cerr
		}
	}()

	if _, err := io.Copy(out, in); err != nil {
		return err
	}

	if err := out.Sync(); err != nil {
		return err
	}

	return nil
}

func SyncConfigSD(isUpdate bool) {
	resp, err := rpcGetSDMountStatus()
	if err != nil {
		logger.Error().Err(err).Msg("failed to get sd mount status")
		return
	}

	if resp.Status == SDMountOK {
		if _, err := os.Stat(configPath); err != nil {
			if err := SaveConfig(); err != nil {
				logger.Error().Err(err).Msg("failed to create kvm_config.json")
				return
			}
		}

		if isUpdate {
			if _, err := os.Stat(sdConfigPath); err == nil {
				if err := copyFile(sdConfigPath, configPath); err != nil {
					logger.Error().Err(err).Msg("failed to copy kvm_config.json from sdcard to userdata")
					return
				}
			} else {
				if err := copyFile(configPath, sdConfigPath); err != nil {
					logger.Error().Err(err).Msg("failed to copy kvm_config.json from userdata to sdcard")
					return
				}
			}
		} else {
			if err := copyFile(configPath, sdConfigPath); err != nil {
				logger.Error().Err(err).Msg("failed to copy kvm_config.json from userdata to sdcard")
				return
			}
		}
	}
}

func SaveConfig() error {
	configLock.Lock()
	defer configLock.Unlock()

	logger.Trace().Str("path", configPath).Msg("Saving config")

	file, err := os.Create(configPath)
	if err != nil {
		return fmt.Errorf("failed to create config file: %w", err)
	}
	defer file.Close()

	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(config); err != nil {
		return fmt.Errorf("failed to encode config: %w", err)
	}

	SyncConfigSD(false)

	return nil
}

func ensureConfigLoaded() {
	if config == nil {
		LoadConfig()
	}
}

var systemInfoWriteLock sync.Mutex

func writeSystemInfoImg() error {
	systemInfoWriteLock.Lock()
	defer systemInfoWriteLock.Unlock()

	imgPath := filepath.Join(imagesFolder, "system_info.img")
	unverifiedimgPath := filepath.Join(imagesFolder, "system_info.img") + ".unverified"
	mountPoint := "/mnt/system_info"

	run := func(cmd string, args ...string) error {
		c := exec.Command(cmd, args...)
		c.Stdout = os.Stdout
		c.Stderr = os.Stderr
		return c.Run()
	}

	if _, err := os.Stat(unverifiedimgPath); err == nil {
		err := os.Rename(unverifiedimgPath, imgPath)
		if err != nil {
			return fmt.Errorf("failed to rename %s to %s: %v", unverifiedimgPath, imgPath, err)
		}
		return nil
	}

	isMounted := false
	if f, err := os.Open("/proc/mounts"); err == nil {
		defer f.Close()
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			fields := strings.Fields(scanner.Text())
			if len(fields) >= 2 && fields[1] == mountPoint {
				isMounted = true
				break
			}
		}
	}

	if isMounted {
		logger.Info().Msgf("%s is mounted, umounting...\n", mountPoint)
		_ = run("umount", mountPoint)
	}

	if _, err := os.Stat(mountPoint); err == nil {
		if err := os.Remove(mountPoint); err != nil {
			return fmt.Errorf("failed to remove %s: %v", mountPoint, err)
		}
	}

	if _, err := os.Stat(imgPath); err == nil {
		if err := copyFile(imgPath, unverifiedimgPath); err != nil {
			logger.Error().Err(err).Msg("failed to copy system_info.img")
			return err
		}
	} else {
		if err := run("dd", "if=/dev/zero", "of="+unverifiedimgPath, "bs=1M", "count=4"); err != nil {
			return fmt.Errorf("dd failed: %v", err)
		}

		if err := run("mkfs.vfat", unverifiedimgPath); err != nil {
			return fmt.Errorf("mkfs.vfat failed: %v", err)
		}
	}

	if err := os.MkdirAll(mountPoint, 0755); err != nil {
		return fmt.Errorf("mkdir failed: %v", err)
	}

	if err := run("mount", "-o", "loop", unverifiedimgPath, mountPoint); err != nil {
		return fmt.Errorf("mount failed: %v", err)
	}

	if err := run("cp", "/etc/hostname", mountPoint+"/hostname.txt"); err != nil {
		return fmt.Errorf("copy hostname failed: %v", err)
	}
	if err := run("sh", "-c", "ip addr show > "+mountPoint+"/network_info.txt"); err != nil {
		return fmt.Errorf("write network info failed: %v", err)
	}

	_ = run("umount", mountPoint)
	if err := os.RemoveAll(mountPoint); err != nil {
		return fmt.Errorf("failed to remove %s: %v", mountPoint, err)
	}

	if err := os.Rename(unverifiedimgPath, imgPath); err != nil {
		return fmt.Errorf("failed to rename %s to %s: %v", unverifiedimgPath, imgPath, err)
	}

	logger.Info().Msg("system_info.img update successfully")
	return nil
}
