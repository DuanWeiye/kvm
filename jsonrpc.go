package kvm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/pion/webrtc/v4"
	"go.bug.st/serial"

	"kvm/internal/usbgadget"
)

type JSONRPCRequest struct {
	JSONRPC string                 `json:"jsonrpc"`
	Method  string                 `json:"method"`
	Params  map[string]interface{} `json:"params,omitempty"`
	ID      interface{}            `json:"id,omitempty"`
}

type JSONRPCResponse struct {
	JSONRPC string      `json:"jsonrpc"`
	Result  interface{} `json:"result,omitempty"`
	Error   interface{} `json:"error,omitempty"`
	ID      interface{} `json:"id"`
}

type JSONRPCEvent struct {
	JSONRPC string      `json:"jsonrpc"`
	Method  string      `json:"method"`
	Params  interface{} `json:"params,omitempty"`
}

type DisplayRotationSettings struct {
	Rotation string `json:"rotation"`
}

type BacklightSettings struct {
	MaxBrightness int `json:"max_brightness"`
	DimAfter      int `json:"dim_after"`
	OffAfter      int `json:"off_after"`
}

func writeJSONRPCResponse(response JSONRPCResponse, session *Session) {
	responseBytes, err := json.Marshal(response)
	if err != nil {
		jsonRpcLogger.Warn().Err(err).Msg("Error marshalling JSONRPC response")
		return
	}
	err = session.RPCChannel.SendText(string(responseBytes))
	if err != nil {
		jsonRpcLogger.Warn().Err(err).Msg("Error sending JSONRPC response")
		return
	}
}

func writeJSONRPCEvent(event string, params interface{}, session *Session) {
	request := JSONRPCEvent{
		JSONRPC: "2.0",
		Method:  event,
		Params:  params,
	}
	requestBytes, err := json.Marshal(request)
	if err != nil {
		jsonRpcLogger.Warn().Err(err).Msg("Error marshalling JSONRPC event")
		return
	}
	if session == nil || session.RPCChannel == nil {
		jsonRpcLogger.Info().Msg("RPC channel not available")
		return
	}

	requestString := string(requestBytes)
	scopedLogger := jsonRpcLogger.With().
		Str("data", requestString).
		Logger()

	scopedLogger.Info().Msg("sending JSONRPC event")

	err = session.RPCChannel.SendText(requestString)
	if err != nil {
		scopedLogger.Warn().Err(err).Msg("error sending JSONRPC event")
		return
	}
}

func DispatchRPCRequest(request JSONRPCRequest) (JSONRPCResponse, error) {
	handler, ok := rpcHandlers[request.Method]
	if !ok {
		return JSONRPCResponse{
			JSONRPC: "2.0",
			Error: map[string]interface{}{
				"code":    -32601,
				"message": "Method not found",
			},
			ID: request.ID,
		}, nil
	}

	result, err := callRPCHandler(handler, request.Params)
	if err != nil {
		return JSONRPCResponse{
			JSONRPC: "2.0",
			Error: map[string]interface{}{
				"code":    -32603,
				"message": "Internal error",
				"data":    err.Error(),
			},
			ID: request.ID,
		}, nil
	}

	return JSONRPCResponse{
		JSONRPC: "2.0",
		Result:  result,
		ID:      request.ID,
	}, nil
}

func onRPCMessage(message webrtc.DataChannelMessage, session *Session) {
	var request JSONRPCRequest
	err := json.Unmarshal(message.Data, &request)
	if err != nil {
		jsonRpcLogger.Warn().
			Str("data", string(message.Data)).
			Err(err).
			Msg("Error unmarshalling JSONRPC request")

		errorResponse := JSONRPCResponse{
			JSONRPC: "2.0",
			Error: map[string]interface{}{
				"code":    -32700,
				"message": "Parse error",
			},
			ID: 0,
		}
		writeJSONRPCResponse(errorResponse, session)
		return
	}

	scopedLogger := jsonRpcLogger.With().
		Str("method", request.Method).
		Interface("params", request.Params).
		Interface("id", request.ID).Logger()

	scopedLogger.Trace().Msg("Received RPC request")

	response, _ := DispatchRPCRequest(request)

	scopedLogger.Trace().Interface("result", response.Result).Msg("RPC handler returned")

	writeJSONRPCResponse(response, session)
}

func rpcPing() (string, error) {
	return "pong", nil
}

func rpcGetDeviceID() (string, error) {
	return GetDeviceID(), nil
}

func rpcReboot(force bool) error {
	logger.Info().Msg("Got reboot request from JSONRPC, rebooting...")

	args := []string{}
	if force {
		args = append(args, "-f")
	}

	cmd := exec.Command("reboot", args...)
	err := cmd.Start()
	if err != nil {
		logger.Error().Err(err).Msg("failed to reboot")
		return fmt.Errorf("failed to reboot: %w", err)
	}

	// If the reboot command is successful, exit the program after 5 seconds
	go func() {
		time.Sleep(5 * time.Second)
		os.Exit(0)
	}()

	return nil
}

var streamFactor = 1.0

func rpcGetStreamQualityFactor() (float64, error) {
	return streamFactor, nil
}

func rpcSetStreamQualityFactor(factor float64) error {
	logger.Info().Float64("factor", factor).Msg("Setting stream quality factor")
	var _, err = CallCtrlAction("set_video_quality_factor", map[string]interface{}{"quality_factor": factor})
	if err != nil {
		return err
	}

	streamFactor = factor
	return nil
}

var streamEncodecType = "avc"

func rpcGetStreamEncodecType() (string, error) {
	return streamEncodecType, nil
}

func rpcSetStreamEncodecType(encodecType string) error {
	logger.Info().Str("encodecType", encodecType).Msg("Setting stream encodec type")
	var _, err = CallCtrlAction("set_video_encodec_type", map[string]interface{}{"encodec_type": encodecType})
	if err != nil {
		return err
	}

	streamEncodecType = encodecType
	return nil
}

func rpcSetNpuAppStatus(enable bool) error {
	logger.Info().Bool("enable", enable).Msg("Setting NPU app status")
	var _, err = CallCtrlAction("set_yolo_enable", map[string]interface{}{"enable": enable})
	if err != nil {
		return err
	}

	config.NpuAppEnabled = enable
	if SaveConfig() != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}
	return nil
}

func rpcGetNpuAppStatus() (bool, error) {
	return config.NpuAppEnabled, nil
}

func rpcGetAutoUpdateState() (bool, error) {
	return config.AutoUpdateEnabled, nil
}

func rpcSetAutoUpdateState(enabled bool) (bool, error) {
	config.AutoUpdateEnabled = enabled
	if err := SaveConfig(); err != nil {
		return config.AutoUpdateEnabled, fmt.Errorf("failed to save config: %w", err)
	}
	return enabled, nil
}

func rpcGetEDID() (string, error) {
	resp, err := CallCtrlAction("get_edid", nil)
	if err != nil {
		return "", err
	}
	edid, ok := resp.Result["edid"]
	if ok {
		return edid.(string), nil
	}
	return "", errors.New("EDID not found in response")
}

func rpcSetEDID(edid string) error {
	if edid == "" {
		logger.Info().Msg("Restoring EDID to default")
		edid = "00ffffffffffff0052620188008888881c150103800000780a0dc9a05747982712484c00000001010101010101010101010101010101023a801871382d40582c4500c48e2100001e011d007251d01e206e285500c48e2100001e000000fc00543734392d6648443732300a20000000fd00147801ff1d000a202020202020017b"
	} else {
		logger.Info().Str("edid", edid).Msg("Setting EDID")
	}
	_, err := CallCtrlAction("set_edid", map[string]interface{}{"edid": edid})
	if err != nil {
		return err
	}

	// Save EDID to config, allowing it to be restored on reboot.
	config.EdidString = edid
	_ = SaveConfig()
	return nil
}

func rpcSetForceHpd(forceHpd bool) error {
	forceHpdValue := 0
	if forceHpd {
		forceHpdValue = 1
	}

	forceHpdPath := "/sys/module/tc35874x/parameters/force_hpd"
	err := os.WriteFile(forceHpdPath, []byte(fmt.Sprintf("%d\n", forceHpdValue)), 0644)
	if err != nil {
		logger.Error().Err(err).Bool("force_hpd", forceHpd).Msg("Failed to set force_hpd parameter")
		return fmt.Errorf("failed to set force_hpd parameter: %w", err)
	}

	logger.Info().Bool("force_hpd", forceHpd).Msg("Force HPD setting applied")

	config.ForceHpd = forceHpd
	if err := SaveConfig(); err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}

	return nil
}

func rpcGetForceHpd() (bool, error) {
	forceHpdPath := "/sys/module/tc35874x/parameters/force_hpd"
	data, err := os.ReadFile(forceHpdPath)
	if err != nil {
		if os.IsNotExist(err) {
			return config.ForceHpd, nil
		}
		logger.Error().Err(err).Msg("Failed to read force_hpd parameter")
		return config.ForceHpd, fmt.Errorf("failed to read force_hpd parameter: %w", err)
	}

	forceHpdValue := strings.TrimSpace(string(data))
	if forceHpdValue == "1" {
		return true, nil
	} else if forceHpdValue == "0" {
		return false, nil
	} else {
		logger.Warn().Str("force_hpd_value", forceHpdValue).Msg("Unexpected force_hpd value, using config value")
		return config.ForceHpd, nil
	}
}

func rpcGetDevChannelState() (bool, error) {
	return config.IncludePreRelease, nil
}

func rpcSetDevChannelState(enabled bool) error {
	config.IncludePreRelease = enabled
	if err := SaveConfig(); err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}
	return nil
}

func rpcGetLocalUpdateStatus() (*LocalMetadata, error) {
	var localStatus LocalMetadata
	systemVersionLocal, appVersionLocal, err := GetLocalVersion()
	if err != nil {
		return nil, fmt.Errorf("failed to get local version: %w", err)
	}
	localStatus.AppVersion = appVersionLocal.String()
	localStatus.SystemVersion = systemVersionLocal.String()
	return &localStatus, nil
}

func rpcGetUpdateStatus() (*UpdateStatus, error) {
	includePreRelease := config.IncludePreRelease
	updateStatus, err := GetUpdateStatus(context.Background(), GetDeviceID(), includePreRelease)
	// to ensure backwards compatibility,
	// if there's an error, we won't return an error, but we will set the error field
	if err != nil {
		if updateStatus == nil {
			return nil, fmt.Errorf("error checking for updates: %w", err)
		}
		updateStatus.Error = err.Error()
	}

	return updateStatus, nil
}

func rpcTryUpdate() error {
	includePreRelease := config.IncludePreRelease
	go func() {
		err := TryUpdate(context.Background(), GetDeviceID(), includePreRelease)
		if err != nil {
			logger.Warn().Err(err).Msg("failed to try update")
		}
	}()
	return nil
}

func rpcGetCustomUpdateBaseURL() (string, error) {
	return customUpdateBaseURL, nil
}

func rpcSetCustomUpdateBaseURL(baseURL string) error {
	customUpdateBaseURL = baseURL
	return nil
}

func rpcSetDisplayRotation(params DisplayRotationSettings) error {
	var err error
	_, err = lvDispSetRotation(params.Rotation)
	if err == nil {
		config.DisplayRotation = params.Rotation
		if err := SaveConfig(); err != nil {
			return fmt.Errorf("failed to save config: %w", err)
		}
	}
	return err
}

func rpcGetDisplayRotation() (*DisplayRotationSettings, error) {
	return &DisplayRotationSettings{
		Rotation: config.DisplayRotation,
	}, nil
}

func rpcSetBacklightSettings(params BacklightSettings) error {
	blConfig := params

	// NOTE: by default, the frontend limits the brightness to 64, as that's what the device originally shipped with.
	if blConfig.MaxBrightness > 255 || blConfig.MaxBrightness < 0 {
		return fmt.Errorf("maxBrightness must be between 0 and 255")
	}

	if blConfig.DimAfter < 0 {
		return fmt.Errorf("dimAfter must be a positive integer")
	}

	if blConfig.OffAfter < 0 {
		return fmt.Errorf("offAfter must be a positive integer")
	}

	config.DisplayMaxBrightness = blConfig.MaxBrightness
	config.DisplayDimAfterSec = blConfig.DimAfter
	config.DisplayOffAfterSec = blConfig.OffAfter

	if err := SaveConfig(); err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}

	logger.Info().Int("max_brightness", config.DisplayMaxBrightness).Int("dim_after", config.DisplayDimAfterSec).Int("off_after", config.DisplayOffAfterSec).Msg("rpc: display: settings applied")

	// If the device started up with auto-dim and/or auto-off set to zero, the display init
	// method will not have started the tickers. So in case that has changed, attempt to start the tickers now.
	startBacklightTickers()

	// Wake the display after the settings are altered, this ensures the tickers
	// are reset to the new settings, and will bring the display up to maxBrightness.
	// Calling with force set to true, to ignore the current state of the display, and force
	// it to reset the tickers.
	wakeDisplay(true)
	return nil
}

func rpcGetBacklightSettings() (*BacklightSettings, error) {
	return &BacklightSettings{
		MaxBrightness: config.DisplayMaxBrightness,
		DimAfter:      int(config.DisplayDimAfterSec),
		OffAfter:      int(config.DisplayOffAfterSec),
	}, nil
}

func rpcSetTimeZone(timeZone string) error {
	var err error
	_, err = CallDisplayCtrlAction("set_timezone", map[string]interface{}{"timezone": timeZone})

	if err == nil {
		config.TimeZone = timeZone
		if err := SaveConfig(); err != nil {
			return fmt.Errorf("failed to save config: %w", err)
		}
	}

	return err
}

func rpcGetTimeZone() (string, error) {
	return config.TimeZone, nil
}

const (
	devModeFile = "/userdata/picokvm/devmode.enable"
	sshKeyDir   = "/userdata/openssh/.ssh"
	sshKeyFile  = "/userdata/openssh/.ssh/authorized_keys"
)

type DevModeState struct {
	Enabled bool `json:"enabled"`
}

type SSHKeyState struct {
	SSHKey string `json:"sshKey"`
}

func rpcGetDevModeState() (DevModeState, error) {
	devModeEnabled := false
	if _, err := os.Stat(devModeFile); err != nil {
		if !os.IsNotExist(err) {
			return DevModeState{}, fmt.Errorf("error checking dev mode file: %w", err)
		}
	} else {
		devModeEnabled = true
	}

	return DevModeState{
		Enabled: devModeEnabled,
	}, nil
}

func rpcGetSSHKeyState() (string, error) {
	keyData, err := os.ReadFile(sshKeyFile)
	if err != nil {
		if !os.IsNotExist(err) {
			return "", fmt.Errorf("error reading SSH key file: %w", err)
		}
	}
	return string(keyData), nil
}

func rpcSetSSHKeyState(sshKey string) error {
	if sshKey != "" {
		// Create directory if it doesn't exist
		if err := os.MkdirAll(sshKeyDir, 0700); err != nil {
			return fmt.Errorf("failed to create SSH key directory: %w", err)
		}

		// Write SSH key to file
		if err := os.WriteFile(sshKeyFile, []byte(sshKey), 0600); err != nil {
			return fmt.Errorf("failed to write SSH key: %w", err)
		}
	} else {
		// Remove SSH key file if empty string is provided
		if err := os.Remove(sshKeyFile); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("failed to remove SSH key file: %w", err)
		}
	}

	return nil
}

func rpcGetTLSState() TLSState {
	return getTLSState()
}

func rpcSetTLSState(state TLSState) error {
	err := setTLSState(state)
	if err != nil {
		return fmt.Errorf("failed to set TLS state: %w", err)
	}

	if err := SaveConfig(); err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}

	return nil
}

type RPCHandler struct {
	Func   interface{}
	Params []string
}

// call the handler but recover from a panic to ensure our RPC thread doesn't collapse on malformed calls
func callRPCHandler(handler RPCHandler, params map[string]interface{}) (result interface{}, err error) {
	// Use defer to recover from a panic
	defer func() {
		if r := recover(); r != nil {
			// Convert the panic to an error
			if e, ok := r.(error); ok {
				err = e
			} else {
				err = fmt.Errorf("panic occurred: %v", r)
			}
		}
	}()

	// Call the handler
	result, err = riskyCallRPCHandler(handler, params)
	return result, err
}

func riskyCallRPCHandler(handler RPCHandler, params map[string]interface{}) (interface{}, error) {
	handlerValue := reflect.ValueOf(handler.Func)
	handlerType := handlerValue.Type()

	if handlerType.Kind() != reflect.Func {
		return nil, errors.New("handler is not a function")
	}

	numParams := handlerType.NumIn()
	args := make([]reflect.Value, numParams)
	// Get the parameter names from the RPCHandler
	paramNames := handler.Params

	if len(paramNames) != numParams {
		return nil, errors.New("mismatch between handler parameters and defined parameter names")
	}

	for i := 0; i < numParams; i++ {
		paramType := handlerType.In(i)
		paramName := paramNames[i]
		paramValue, ok := params[paramName]
		if !ok {
			return nil, errors.New("missing parameter: " + paramName)
		}

		convertedValue := reflect.ValueOf(paramValue)
		if !convertedValue.Type().ConvertibleTo(paramType) {
			if paramType.Kind() == reflect.Slice && (convertedValue.Kind() == reflect.Slice || convertedValue.Kind() == reflect.Array) {
				newSlice := reflect.MakeSlice(paramType, convertedValue.Len(), convertedValue.Len())
				for j := 0; j < convertedValue.Len(); j++ {
					elemValue := convertedValue.Index(j)
					if elemValue.Kind() == reflect.Interface {
						elemValue = elemValue.Elem()
					}
					if !elemValue.Type().ConvertibleTo(paramType.Elem()) {
						// Handle float64 to uint8 conversion
						if elemValue.Kind() == reflect.Float64 && paramType.Elem().Kind() == reflect.Uint8 {
							intValue := int(elemValue.Float())
							if intValue < 0 || intValue > 255 {
								return nil, fmt.Errorf("value out of range for uint8: %v", intValue)
							}
							newSlice.Index(j).SetUint(uint64(intValue))
						} else {
							fromType := elemValue.Type()
							toType := paramType.Elem()
							return nil, fmt.Errorf("invalid element type in slice for parameter %s: from %v to %v", paramName, fromType, toType)
						}
					} else {
						newSlice.Index(j).Set(elemValue.Convert(paramType.Elem()))
					}
				}
				args[i] = newSlice
			} else if paramType.Kind() == reflect.Struct && convertedValue.Kind() == reflect.Map {
				jsonData, err := json.Marshal(convertedValue.Interface())
				if err != nil {
					return nil, fmt.Errorf("failed to marshal map to JSON: %v", err)
				}

				newStruct := reflect.New(paramType).Interface()
				if err := json.Unmarshal(jsonData, newStruct); err != nil {
					return nil, fmt.Errorf("failed to unmarshal JSON into struct: %v", err)
				}
				args[i] = reflect.ValueOf(newStruct).Elem()
			} else {
				return nil, fmt.Errorf("invalid parameter type for: %s, type: %s", paramName, paramType.Kind())
			}
		} else {
			args[i] = convertedValue.Convert(paramType)
		}
	}

	results := handlerValue.Call(args)

	if len(results) == 0 {
		return nil, nil
	}

	if len(results) == 1 {
		if results[0].Type().Implements(reflect.TypeOf((*error)(nil)).Elem()) {
			if !results[0].IsNil() {
				return nil, results[0].Interface().(error)
			}
			return nil, nil
		}
		return results[0].Interface(), nil
	}

	if len(results) == 2 && results[1].Type().Implements(reflect.TypeOf((*error)(nil)).Elem()) {
		if !results[1].IsNil() {
			return nil, results[1].Interface().(error)
		}
		return results[0].Interface(), nil
	}

	return nil, errors.New("unexpected return values from handler")
}

func rpcSetMassStorageMode(mode string) (string, error) {
	logger.Info().Str("mode", mode).Msg("Setting mass storage mode")
	var cdrom bool
	switch mode {
	case "cdrom":
		cdrom = true
	case "file":
		cdrom = false
	default:
		logger.Info().Str("mode", mode).Msg("Invalid mode provided")
		return "", fmt.Errorf("invalid mode: %s", mode)
	}

	logger.Info().Str("mode", mode).Msg("Setting mass storage mode")

	err := setMassStorageMode(cdrom)
	if err != nil {
		return "", fmt.Errorf("failed to set mass storage mode: %w", err)
	}

	logger.Info().Str("mode", mode).Msg("Mass storage mode set")

	// Get the updated mode after setting
	return rpcGetMassStorageMode()
}

func rpcGetMassStorageMode() (string, error) {
	cdrom, err := getMassStorageCDROMEnabled()
	if err != nil {
		return "", fmt.Errorf("failed to get mass storage mode: %w", err)
	}

	mode := "file"
	if cdrom {
		mode = "cdrom"
	}
	return mode, nil
}

func rpcIsUpdatePending() (bool, error) {
	return IsUpdatePending(), nil
}

func rpcGetUsbEmulationState() (bool, error) {
	return gadget.IsUDCBound()
}

func rpcSetUsbEmulationState(enabled bool) error {
	if enabled {
		return gadget.BindUDCToDWC3()
	} else {
		return gadget.UnbindUDCToDWC3()
	}
}

func rpcGetUsbConfig() (usbgadget.Config, error) {
	LoadConfig()
	return *config.UsbConfig, nil
}

func rpcSetUsbConfig(usbConfig usbgadget.Config) error {
	LoadConfig()
	config.UsbConfig = &usbConfig
	gadget.SetGadgetConfig(config.UsbConfig)
	return updateUsbRelatedConfig()
}

func rpcGetWakeOnLanDevices() ([]WakeOnLanDevice, error) {
	if config.WakeOnLanDevices == nil {
		return []WakeOnLanDevice{}, nil
	}
	return config.WakeOnLanDevices, nil
}

type SetWakeOnLanDevicesParams struct {
	Devices []WakeOnLanDevice `json:"devices"`
}

func rpcSetWakeOnLanDevices(params SetWakeOnLanDevicesParams) error {
	config.WakeOnLanDevices = params.Devices
	return SaveConfig()
}

func rpcResetConfig() error {
	loadedConfig := *defaultConfig
	config = &loadedConfig
	if err := SaveConfig(); err != nil {
		return fmt.Errorf("failed to reset config: %w", err)
	}

	logger.Info().Msg("Configuration reset to default")
	return nil
}

func rpcGetActiveExtension() (string, error) {
	return config.ActiveExtension, nil
}

func rpcSetActiveExtension(extensionId string) error {
	if config.ActiveExtension == extensionId {
		return nil
	}
	config.ActiveExtension = extensionId
	if err := SaveConfig(); err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}
	return nil
}

type SerialSettings struct {
	BaudRate string `json:"baudRate"`
	DataBits string `json:"dataBits"`
	StopBits string `json:"stopBits"`
	Parity   string `json:"parity"`
}

func rpcGetSerialSettings() (SerialSettings, error) {
	settings := SerialSettings{
		BaudRate: strconv.Itoa(serialPortMode.BaudRate),
		DataBits: strconv.Itoa(serialPortMode.DataBits),
		StopBits: "1",
		Parity:   "none",
	}

	switch serialPortMode.StopBits {
	case serial.OneStopBit:
		settings.StopBits = "1"
	case serial.OnePointFiveStopBits:
		settings.StopBits = "1.5"
	case serial.TwoStopBits:
		settings.StopBits = "2"
	}

	switch serialPortMode.Parity {
	case serial.NoParity:
		settings.Parity = "none"
	case serial.OddParity:
		settings.Parity = "odd"
	case serial.EvenParity:
		settings.Parity = "even"
	case serial.MarkParity:
		settings.Parity = "mark"
	case serial.SpaceParity:
		settings.Parity = "space"
	}

	return settings, nil
}

var serialPortMode = defaultMode

func rpcSetSerialSettings(settings SerialSettings) error {
	baudRate, err := strconv.Atoi(settings.BaudRate)
	if err != nil {
		return fmt.Errorf("invalid baud rate: %v", err)
	}
	dataBits, err := strconv.Atoi(settings.DataBits)
	if err != nil {
		return fmt.Errorf("invalid data bits: %v", err)
	}

	var stopBits serial.StopBits
	switch settings.StopBits {
	case "1":
		stopBits = serial.OneStopBit
	case "1.5":
		stopBits = serial.OnePointFiveStopBits
	case "2":
		stopBits = serial.TwoStopBits
	default:
		return fmt.Errorf("invalid stop bits: %s", settings.StopBits)
	}

	var parity serial.Parity
	switch settings.Parity {
	case "none":
		parity = serial.NoParity
	case "odd":
		parity = serial.OddParity
	case "even":
		parity = serial.EvenParity
	case "mark":
		parity = serial.MarkParity
	case "space":
		parity = serial.SpaceParity
	default:
		return fmt.Errorf("invalid parity: %s", settings.Parity)
	}
	serialPortMode = &serial.Mode{
		BaudRate: baudRate,
		DataBits: dataBits,
		StopBits: stopBits,
		Parity:   parity,
	}

	_ = port.SetMode(serialPortMode)

	return nil
}

func rpcGetUsbDevices() (usbgadget.Devices, error) {
	return *config.UsbDevices, nil
}

func updateUsbRelatedConfig() error {
	if err := gadget.UpdateGadgetConfig(); err != nil {
		return fmt.Errorf("failed to write gadget config: %w", err)
	}
	if err := SaveConfig(); err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}
	return nil
}

func rpcSetUsbDevices(usbDevices usbgadget.Devices) error {
	mediaState, _ := rpcGetVirtualMediaState()
	if mediaState != nil && mediaState.Filename != "" {
		err := rpcUnmountImage()
		if err != nil {
			jsonRpcLogger.Error().Err(err).Msg("failed to unmount image")
		}
	}
	config.UsbDevices = &usbDevices
	gadget.SetGadgetDevices(config.UsbDevices)
	return updateUsbRelatedConfig()
}

func rpcSetUsbDeviceState(device string, enabled bool) error {
	switch device {
	case "absoluteMouse":
		config.UsbDevices.AbsoluteMouse = enabled
	case "relativeMouse":
		config.UsbDevices.RelativeMouse = enabled
	case "keyboard":
		config.UsbDevices.Keyboard = enabled
	case "massStorage":
		config.UsbDevices.MassStorage = enabled
	default:
		return fmt.Errorf("invalid device: %s", device)
	}
	gadget.SetGadgetDevices(config.UsbDevices)
	return updateUsbRelatedConfig()
}

func rpcGetKeyboardLayout() (string, error) {
	return config.KeyboardLayout, nil
}

func rpcSetKeyboardLayout(layout string) error {
	config.KeyboardLayout = layout
	if err := SaveConfig(); err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}
	return nil
}

func getKeyboardMacros() (interface{}, error) {
	macros := make([]KeyboardMacro, len(config.KeyboardMacros))
	copy(macros, config.KeyboardMacros)

	return macros, nil
}

type KeyboardMacrosParams struct {
	Macros []interface{} `json:"macros"`
}

func setKeyboardMacros(params KeyboardMacrosParams) (interface{}, error) {
	if params.Macros == nil {
		return nil, fmt.Errorf("missing or invalid macros parameter")
	}

	newMacros := make([]KeyboardMacro, 0, len(params.Macros))

	for i, item := range params.Macros {
		macroMap, ok := item.(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("invalid macro at index %d", i)
		}

		id, _ := macroMap["id"].(string)
		if id == "" {
			id = fmt.Sprintf("macro-%d", time.Now().UnixNano())
		}

		name, _ := macroMap["name"].(string)

		sortOrder := i + 1
		if sortOrderFloat, ok := macroMap["sortOrder"].(float64); ok {
			sortOrder = int(sortOrderFloat)
		}

		steps := []KeyboardMacroStep{}
		if stepsArray, ok := macroMap["steps"].([]interface{}); ok {
			for _, stepItem := range stepsArray {
				stepMap, ok := stepItem.(map[string]interface{})
				if !ok {
					continue
				}

				step := KeyboardMacroStep{}

				if keysArray, ok := stepMap["keys"].([]interface{}); ok {
					for _, k := range keysArray {
						if keyStr, ok := k.(string); ok {
							step.Keys = append(step.Keys, keyStr)
						}
					}
				}

				if modsArray, ok := stepMap["modifiers"].([]interface{}); ok {
					for _, m := range modsArray {
						if modStr, ok := m.(string); ok {
							step.Modifiers = append(step.Modifiers, modStr)
						}
					}
				}

				if delay, ok := stepMap["delay"].(float64); ok {
					step.Delay = int(delay)
				}

				steps = append(steps, step)
			}
		}

		macro := KeyboardMacro{
			ID:        id,
			Name:      name,
			Steps:     steps,
			SortOrder: sortOrder,
		}

		if err := macro.Validate(); err != nil {
			return nil, fmt.Errorf("invalid macro at index %d: %w", i, err)
		}

		newMacros = append(newMacros, macro)
	}

	config.KeyboardMacros = newMacros

	if err := SaveConfig(); err != nil {
		return nil, err
	}

	return nil, nil
}

func rpcGetLocalLoopbackOnly() (bool, error) {
	return config.LocalLoopbackOnly, nil
}

func rpcSetLocalLoopbackOnly(enabled bool) error {
	// Check if the setting is actually changing
	if config.LocalLoopbackOnly == enabled {
		return nil
	}

	// Update the setting
	config.LocalLoopbackOnly = enabled
	if err := SaveConfig(); err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}

	return nil
}

type IOSettings struct {
	IO0Status bool `json:"io0Status"`
	IO1Status bool `json:"io1Status"`
}

func rpcGetIOSettings() (IOSettings, error) {
	LoadConfig()
	settings := IOSettings{
		IO0Status: config.IO0Status,
		IO1Status: config.IO1Status,
	}

	return settings, nil
}

func rpcSetIOSettings(settings IOSettings) error {
	LoadConfig()
	// IO0: GPIO58 IO1: GPIO59
	_ = setGPIOValue(58, settings.IO0Status)
	_ = setGPIOValue(59, settings.IO1Status)

	config.IO0Status = settings.IO0Status
	config.IO1Status = settings.IO1Status
	if err := SaveConfig(); err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}

	return nil
}

func rpcSetIOStatus(ioName string, status bool) error {
	var pin int
	if ioName == "power" {
		pin = 58
	} else if ioName == "reset" {
		pin = 59
	} else {
		return fmt.Errorf("unknown IO name: %s", ioName)
	}

	if err := setGPIOValue(pin, status); err != nil {
		return fmt.Errorf("failed to set GPIO value: %v", err)
	}
	return nil
}

func rpcTriggerPower() error {
	go func() {
		if err := pulseGPIO(58, 2*time.Second); err != nil {
			logger.Error().Err(err).Msg("Failed to trigger power pulse")
		}
	}()
	return nil
}

func rpcTriggerReset() error {
	go func() {
		if err := pulseGPIO(59, 2*time.Second); err != nil {
			logger.Error().Err(err).Msg("Failed to trigger reset pulse")
		}
	}()
	return nil
}

func rpcResetIOInput() error {
	if err := resetIOInput(); err != nil {
		return err
	}
	return nil
}

func rpcGetIOInputStatus() (map[string]bool, error) {
	// IO2: GPIO0 - Power LED
	// IO3: GPIO1 - HDD LED
	powerLed, err := getGPIOValue(0)
	if err != nil {
		logger.Error().Err(err).Msg("Failed to read Power LED status")
		// Don't return error, just default to false
	}

	hddLed, err := getGPIOValue(1)
	if err != nil {
		logger.Error().Err(err).Msg("Failed to read HDD LED status")
		// Don't return error, just default to false
	}

	// Active Low: Low level means LED is ON (Radio active)
	return map[string]bool{
		"powerLed": !powerLed,
		"hddLed":   !hddLed,
	}, nil
}

func rpcGetAudioMode() (string, error) {
	return config.AudioMode, nil
}

func rpcSetAudioMode(mode string) error {
	config.AudioMode = mode
	if err := SaveConfig(); err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}

	if config.AudioMode != "disabled" {
		StartNtpAudioServer(handleAudioClient)
	} else {
		StopNtpAudioServer()
	}

	return nil
}

func rpcSetLedGreenMode(mode string) error {
	err := setLedMode(ledGreenPath, mode)
	if err != nil {
		return err
	}

	config.LEDGreenMode = mode
	if err := SaveConfig(); err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}
	return nil
}

func rpcSetLedYellowMode(mode string) error {
	err := setLedMode(ledYellowPath, mode)
	if err != nil {
		return err
	}

	config.LEDYellowMode = mode
	if err := SaveConfig(); err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}
	return nil
}

func rpcGetLedGreenMode() (string, error) {
	return config.LEDGreenMode, nil
}

func rpcGetLedYellowMode() (string, error) {
	return config.LEDYellowMode, nil
}

func rpcGetAutoMountSystemInfo() (bool, error) {
	return config.AutoMountSystemInfo, nil
}

func rpcSetAutoMountSystemInfo(enabled bool) error {
	config.AutoMountSystemInfo = enabled
	if err := SaveConfig(); err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}
	return nil
}

func rpcConfirmOtherSession() (bool, error) {
	return true, nil
}

var rpcHandlers = map[string]RPCHandler{
	"ping":                      {Func: rpcPing},
	"reboot":                    {Func: rpcReboot, Params: []string{"force"}},
	"getDeviceID":               {Func: rpcGetDeviceID},
	"getNetworkState":           {Func: rpcGetNetworkState},
	"getNetworkSettings":        {Func: rpcGetNetworkSettings},
	"setNetworkSettings":        {Func: rpcSetNetworkSettings, Params: []string{"settings"}},
	"renewDHCPLease":            {Func: rpcRenewDHCPLease},
	"requestDHCPAddress":        {Func: rpcRequestDHCPAddress, Params: []string{"ip"}},
	"keyboardReport":            {Func: rpcKeyboardReport, Params: []string{"modifier", "keys"}},
	"getKeyboardLedState":       {Func: rpcGetKeyboardLedState},
	"absMouseReport":            {Func: rpcAbsMouseReport, Params: []string{"x", "y", "buttons"}},
	"relMouseReport":            {Func: rpcRelMouseReport, Params: []string{"dx", "dy", "buttons"}},
	"wheelReport":               {Func: rpcWheelReport, Params: []string{"wheelY"}},
	"getVideoState":             {Func: rpcGetVideoState},
	"getUSBState":               {Func: rpcGetUSBState},
	"reinitializeUsbGadget":     {Func: rpcReinitializeUsbGadget},
	"reinitializeUsbGadgetSoft": {Func: rpcReinitializeUsbGadgetSoft},
	"unmountImage":              {Func: rpcUnmountImage},
	"rpcMountBuiltInImage":      {Func: rpcMountBuiltInImage, Params: []string{"filename"}},
	"setJigglerState":           {Func: rpcSetJigglerState, Params: []string{"enabled"}},
	"getJigglerState":           {Func: rpcGetJigglerState},
	"sendUsbWakeupSignal":       {Func: rpcSendUsbWakeupSignal},
	"sendWOLMagicPacket":        {Func: rpcSendWOLMagicPacket, Params: []string{"macAddress"}},
	"getStreamQualityFactor":    {Func: rpcGetStreamQualityFactor},
	"setStreamQualityFactor":    {Func: rpcSetStreamQualityFactor, Params: []string{"factor"}},
	"getAutoUpdateState":        {Func: rpcGetAutoUpdateState},
	"setAutoUpdateState":        {Func: rpcSetAutoUpdateState, Params: []string{"enabled"}},
	"getEDID":                   {Func: rpcGetEDID},
	"setEDID":                   {Func: rpcSetEDID, Params: []string{"edid"}},
	"setForceHpd":               {Func: rpcSetForceHpd, Params: []string{"forceHpd"}},
	"getForceHpd":               {Func: rpcGetForceHpd},
	"getDevChannelState":        {Func: rpcGetDevChannelState},
	"setDevChannelState":        {Func: rpcSetDevChannelState, Params: []string{"enabled"}},
	"getLocalUpdateStatus":      {Func: rpcGetLocalUpdateStatus},
	"getUpdateStatus":           {Func: rpcGetUpdateStatus},
	"tryUpdate":                 {Func: rpcTryUpdate},
	"getCustomUpdateBaseURL":    {Func: rpcGetCustomUpdateBaseURL},
	"setCustomUpdateBaseURL":    {Func: rpcSetCustomUpdateBaseURL, Params: []string{"baseURL"}},
	"getDevModeState":           {Func: rpcGetDevModeState},
	"getSSHKeyState":            {Func: rpcGetSSHKeyState},
	"setSSHKeyState":            {Func: rpcSetSSHKeyState, Params: []string{"sshKey"}},
	"getTLSState":               {Func: rpcGetTLSState},
	"setTLSState":               {Func: rpcSetTLSState, Params: []string{"state"}},
	"setMassStorageMode":        {Func: rpcSetMassStorageMode, Params: []string{"mode"}},
	"getMassStorageMode":        {Func: rpcGetMassStorageMode},
	"isUpdatePending":           {Func: rpcIsUpdatePending},
	"getUsbEmulationState":      {Func: rpcGetUsbEmulationState},
	"setUsbEmulationState":      {Func: rpcSetUsbEmulationState, Params: []string{"enabled"}},
	"getUsbConfig":              {Func: rpcGetUsbConfig},
	"setUsbConfig":              {Func: rpcSetUsbConfig, Params: []string{"usbConfig"}},
	"checkMountUrl":             {Func: rpcCheckMountUrl, Params: []string{"url"}},
	"getVirtualMediaState":      {Func: rpcGetVirtualMediaState},
	"getStorageSpace":           {Func: rpcGetStorageSpace},
	"getSDStorageSpace":         {Func: rpcGetSDStorageSpace},
	"resetSDStorage":            {Func: rpcResetSDStorage},
	"mountSDStorage":            {Func: rpcMountSDStorage},
	"unmountSDStorage":          {Func: rpcUnmountSDStorage},
	"mountWithHTTP":             {Func: rpcMountWithHTTP, Params: []string{"url", "mode"}},
	"mountWithWebRTC":           {Func: rpcMountWithWebRTC, Params: []string{"filename", "size", "mode"}},
	"mountWithStorage":          {Func: rpcMountWithStorage, Params: []string{"filename", "mode"}},
	"mountWithSDStorage":        {Func: rpcMountWithSDStorage, Params: []string{"filename", "mode"}},
	"setAutoMountSystemInfo":    {Func: rpcSetAutoMountSystemInfo, Params: []string{"enabled"}},
	"getAutoMountSystemInfo":    {Func: rpcGetAutoMountSystemInfo},
	"confirmOtherSession":       {Func: rpcConfirmOtherSession},
	"listStorageFiles":          {Func: rpcListStorageFiles},
	"deleteStorageFile":         {Func: rpcDeleteStorageFile, Params: []string{"filename"}},
	"startStorageFileUpload":    {Func: rpcStartStorageFileUpload, Params: []string{"filename", "size"}},
	"listSDStorageFiles":        {Func: rpcListSDStorageFiles},
	"deleteSDStorageFile":       {Func: rpcDeleteSDStorageFile, Params: []string{"filename"}},
	"startSDStorageFileUpload":  {Func: rpcStartSDStorageFileUpload, Params: []string{"filename", "size"}},
	"getWakeOnLanDevices":       {Func: rpcGetWakeOnLanDevices},
	"setWakeOnLanDevices":       {Func: rpcSetWakeOnLanDevices, Params: []string{"params"}},
	"resetConfig":               {Func: rpcResetConfig},
	"setDisplayRotation":        {Func: rpcSetDisplayRotation, Params: []string{"params"}},
	"getDisplayRotation":        {Func: rpcGetDisplayRotation},
	"setBacklightSettings":      {Func: rpcSetBacklightSettings, Params: []string{"params"}},
	"getBacklightSettings":      {Func: rpcGetBacklightSettings},
	"setTimeZone":               {Func: rpcSetTimeZone, Params: []string{"timeZone"}},
	"getTimeZone":               {Func: rpcGetTimeZone},
	"setLedGreenMode":           {Func: rpcSetLedGreenMode, Params: []string{"mode"}},
	"setLedYellowMode":          {Func: rpcSetLedYellowMode, Params: []string{"mode"}},
	"getLedGreenMode":           {Func: rpcGetLedGreenMode},
	"getLedYellowMode":          {Func: rpcGetLedYellowMode},
	"getActiveExtension":        {Func: rpcGetActiveExtension},
	"setActiveExtension":        {Func: rpcSetActiveExtension, Params: []string{"extensionId"}},
	"getSerialSettings":         {Func: rpcGetSerialSettings},
	"setSerialSettings":         {Func: rpcSetSerialSettings, Params: []string{"settings"}},
	"getUsbDevices":             {Func: rpcGetUsbDevices},
	"setUsbDevices":             {Func: rpcSetUsbDevices, Params: []string{"devices"}},
	"setUsbDeviceState":         {Func: rpcSetUsbDeviceState, Params: []string{"device", "enabled"}},
	"getKeyboardLayout":         {Func: rpcGetKeyboardLayout},
	"setKeyboardLayout":         {Func: rpcSetKeyboardLayout, Params: []string{"layout"}},
	"getKeyboardMacros":         {Func: getKeyboardMacros},
	"setKeyboardMacros":         {Func: setKeyboardMacros, Params: []string{"params"}},
	"getLocalLoopbackOnly":      {Func: rpcGetLocalLoopbackOnly},
	"setLocalLoopbackOnly":      {Func: rpcSetLocalLoopbackOnly, Params: []string{"enabled"}},
	"getIOSettings":             {Func: rpcGetIOSettings},
	"setIOSettings":             {Func: rpcSetIOSettings, Params: []string{"settings"}},
	"triggerPower":              {Func: rpcTriggerPower},
	"triggerReset":              {Func: rpcTriggerReset},
	"setIOStatus":               {Func: rpcSetIOStatus, Params: []string{"ioName", "status"}},
	"getIOInputStatus":          {Func: rpcGetIOInputStatus},
	"resetIOInput":              {Func: rpcResetIOInput},
	"getSDMountStatus":          {Func: rpcGetSDMountStatus},
	"loginTailScale":            {Func: rpcLoginTailScale, Params: []string{"xEdge"}},
	"logoutTailScale":           {Func: rpcLogoutTailScale},
	"cancelTailScale":           {Func: rpcCancelTailScale},
	"getTailScaleSettings":      {Func: rpcGetTailScaleSettings},
	"loginZeroTier":             {Func: rpcLoginZeroTier, Params: []string{"networkID"}},
	"logoutZeroTier":            {Func: rpcLogoutZeroTier, Params: []string{"networkID"}},
	"getZeroTierSettings":       {Func: rpcGetZeroTierSettings},
	"setUpdateSource":           {Func: rpcSetUpdateSource, Params: []string{"source"}},
	"getAudioMode":              {Func: rpcGetAudioMode},
	"setAudioMode":              {Func: rpcSetAudioMode, Params: []string{"mode"}},
	"startFrpc":                 {Func: rpcStartFrpc, Params: []string{"frpcToml"}},
	"stopFrpc":                  {Func: rpcStopFrpc},
	"getFrpcStatus":             {Func: rpcGetFrpcStatus},
	"getFrpcToml":               {Func: rpcGetFrpcToml},
	"getFrpcLog":                {Func: rpcGetFrpcLog},
	"startEasyTier":             {Func: rpcStartEasyTier, Params: []string{"name", "secret", "node"}},
	"stopEasyTier":              {Func: rpcStopEasyTier},
	"getEasyTierStatus":         {Func: rpcGetEasyTierStatus},
	"getEasyTierConfig":         {Func: rpcGetEasyTierConfig},
	"getEasyTierLog":            {Func: rpcGetEasyTierLog},
	"startVnt":                  {Func: rpcStartVnt, Params: []string{"config_mode", "token", "device_id", "name", "server_addr", "config_file", "model", "password"}},
	"stopVnt":                   {Func: rpcStopVnt},
	"getVntStatus":              {Func: rpcGetVntStatus},
	"getVntConfig":              {Func: rpcGetVntConfig},
	"getVntConfigFile":          {Func: rpcGetVntConfigFile},
	"getVntLog":                 {Func: rpcGetVntLog},
	"getVntInfo":                {Func: rpcGetVntInfo},
	"getEasyTierNodeInfo":       {Func: rpcGetEasyTierNodeInfo},
	"startCloudflared":          {Func: rpcStartCloudflared, Params: []string{"token"}},
	"stopCloudflared":           {Func: rpcStopCloudflared},
	"getCloudflaredStatus":      {Func: rpcGetCloudflaredStatus},
	"getCloudflaredLog":         {Func: rpcGetCloudflaredLog},
	"getStreamEncodecType":      {Func: rpcGetStreamEncodecType},
	"setStreamEncodecType":      {Func: rpcSetStreamEncodecType, Params: []string{"encodecType"}},
	"setNpuAppStatus":           {Func: rpcSetNpuAppStatus, Params: []string{"enable"}},
	"getNpuAppStatus":           {Func: rpcGetNpuAppStatus},
	"startWireguard":            {Func: rpcStartWireguard, Params: []string{"configFile"}},
	"stopWireguard":             {Func: rpcStopWireguard},
	"getWireguardStatus":        {Func: rpcGetWireguardStatus},
	"getWireguardConfig":        {Func: rpcGetWireguardConfig},
	"getWireguardLog":           {Func: rpcGetWireguardLog},
	"getWireguardInfo":          {Func: rpcGetWireguardInfo},
}
