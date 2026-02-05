import { useCallback, useEffect, useState } from "react";
import { Button as AntdButton , Checkbox } from "antd";
import {useReactAt} from 'i18n-auto-extractor/react'
import { isMobile } from "react-device-detect";

import { ConfirmDialog } from "@components/ConfirmDialog";
import { SettingsPageHeader } from "@components/Settings/SettingsPageheader";
import { TextAreaWithLabel } from "@components/TextArea";
import { useSettingsStore, useHidStore } from "@/hooks/stores";
import { useJsonRpc } from "@/hooks/useJsonRpc";
import { isOnDevice } from "@/main";
import notifications from "@/notifications";
import { SettingsItem } from "@components/Settings/SettingsView";

export default function SettingsAdvanced() {
  const { $at }= useReactAt();
  const [send] = useJsonRpc();

  const [sshKey, setSSHKey] = useState<string>("");
  const setDeveloperMode = useSettingsStore(state => state.setDeveloperMode);
  const [usbEmulationEnabled, setUsbEmulationEnabled] = useState(false);
  const [showLoopbackWarning, setShowLoopbackWarning] = useState(false);
  const [showRebootConfirm, setShowRebootConfirm] = useState(false);
  const [localLoopbackOnly, setLocalLoopbackOnly] = useState(false);

  const settings = useSettingsStore();
  const isReinitializingGadget = useHidStore(state => state.isReinitializingGadget);
  const setIsReinitializingGadget = useHidStore(state => state.setIsReinitializingGadget);

  useEffect(() => {
    send("getSSHKeyState", {}, resp => {
      if ("error" in resp) return;
      setSSHKey(resp.result as string);
    });

    send("getUsbEmulationState", {}, resp => {
      if ("error" in resp) return;
      setUsbEmulationEnabled(resp.result as boolean);
    });

    send("getLocalLoopbackOnly", {}, resp => {
      if ("error" in resp) return;
      setLocalLoopbackOnly(resp.result as boolean);
    });
  }, [send, setDeveloperMode]);

  const getUsbEmulationState = useCallback(() => {
    send("getUsbEmulationState", {}, resp => {
      if ("error" in resp) return;
      setUsbEmulationEnabled(resp.result as boolean);
    });
  }, [send]);

  const handleUsbEmulationToggle = useCallback(
    (enabled: boolean) => {
      send("setUsbEmulationState", { enabled: enabled }, resp => {
        if ("error" in resp) {
          notifications.error(
            `Failed to ${enabled ? "enable" : "disable"} USB emulation: ${resp.error.data || "Unknown error"}`,
          );
          return;
        }
        setUsbEmulationEnabled(enabled);
        getUsbEmulationState();
      });
    },
    [getUsbEmulationState, send],
  );

  const handleResetConfig = useCallback(() => {
    send("resetConfig", {}, resp => {
      if ("error" in resp) {
        notifications.error(
          `Failed to reset configuration: ${resp.error.data || "Unknown error"}`,
        );
        return;
      }
      notifications.success("Configuration reset to default successfully");
    });
  }, [send]);

  const handleUpdateSSHKey = useCallback(() => {
    send("setSSHKeyState", { sshKey }, resp => {
      if ("error" in resp) {
        notifications.error(
          `Failed to update SSH key: ${resp.error.data || "Unknown error"}`,
        );
        return;
      }
      notifications.success("SSH key updated successfully");
    });
  }, [send, sshKey]);

  const applyLoopbackOnlyMode = useCallback(
    (enabled: boolean) => {
      send("setLocalLoopbackOnly", { enabled }, resp => {
        if ("error" in resp) {
          notifications.error(
            `Failed to ${enabled ? "enable" : "disable"} loopback-only mode: ${resp.error.data || "Unknown error"}`,
          );
          return;
        }
        setLocalLoopbackOnly(enabled);
        if (enabled) {
          notifications.success(
            "Loopback-only mode enabled. Restart your device to apply.",
          );
        } else {
          notifications.success(
            "Loopback-only mode disabled. Restart your device to apply.",
          );
        }
      });
    },
    [send, setLocalLoopbackOnly],
  );

  const handleLoopbackOnlyModeChange = useCallback(
    (enabled: boolean) => {
      // If trying to enable loopback-only mode, show warning first
      if (enabled) {
        setShowLoopbackWarning(true);
      } else {
        // If disabling, just proceed
        applyLoopbackOnlyMode(false);
      }
    },
    [applyLoopbackOnlyMode, setShowLoopbackWarning],
  );

  const confirmLoopbackModeEnable = useCallback(() => {
    applyLoopbackOnlyMode(true);
    setShowLoopbackWarning(false);
  }, [applyLoopbackOnlyMode, setShowLoopbackWarning]);

  return (
    <div className="space-y-4">
      <SettingsPageHeader
        title={$at("Advanced")}
        description={$at("Access additional settings for troubleshooting and customization")}
      />

      <div className="space-y-4">
        <SettingsItem
          title={$at("Loopback-Only Mode")}
          description={$at("Restrict web interface access to localhost only (127.0.0.1)")}
        noCol
        >
          <Checkbox
            checked={localLoopbackOnly}
            onChange={e => handleLoopbackOnlyModeChange(e.target.checked)}
          />
        </SettingsItem>

        {isOnDevice && (
          <div className="space-y-4">
            <SettingsItem
              title={$at("SSH Access")}
              description={$at("Add your SSH public key to enable secure remote access to the device")}
            />
            <div className="space-y-4">
              <TextAreaWithLabel
                label={$at("SSH Public Key")}
                value={sshKey || ""}
                rows={3}
                onChange={e => setSSHKey(e.target.value)}
                placeholder={$at("Enter your SSH public key")}
              />
              <p className="text-xs text-slate-600 dark:text-[#ffffff]">
                {$at("The default SSH user is ")} <strong>root</strong>.
              </p>
              <div className="flex items-center gap-x-2">
                <AntdButton
                  type="primary"
                  onClick={handleUpdateSSHKey}
                  className={isMobile?"w-full":""}
                >
                  {$at("Update SSH Key")}
                </AntdButton>
              </div>
            </div>
          </div>
        )}

        <SettingsItem
          title={$at("Force HTTP Transmission")}
          badge="Experimental"
          description={$at("Force using HTTP for video streaming instead of WebRTC")}
          noCol
        >
          <Checkbox
            checked={settings.forceHttp}
            onChange={e => {
              settings.setForceHttp(e.target.checked);
              window.location.reload();
            }}
          />
        </SettingsItem>

        <SettingsItem
          title={$at("USB Emulation")}
          description={$at("Control the USB emulation state")}
        >
          <AntdButton

            type="primary"
            className={`${isMobile?"w-full":""}`}
            onClick={() => handleUsbEmulationToggle(!usbEmulationEnabled)}
          >
            {
              usbEmulationEnabled ? $at("Disable USB Emulation") : $at("Enable USB Emulation")
            }
          </AntdButton>
        </SettingsItem>

        <SettingsItem
          title={$at("USB Gadget Reinitialize")}
          description={$at("Reinitialize USB gadget configuration")}
        >
          <AntdButton
            type="primary"
            className={`${isMobile?"w-full":""}`}
            disabled={isReinitializingGadget}
            loading={isReinitializingGadget}
            onClick={() => {
              if (isReinitializingGadget) return;
              setIsReinitializingGadget(true);
              send("reinitializeUsbGadget", {}, resp => {
                setIsReinitializingGadget(false);
                if ("error" in resp) {
                  notifications.error(
                    `Failed to reinitialize USB gadget: ${resp.error.data || "Unknown error"}`,
                  );
                  return;
                }
                notifications.success("USB gadget reinitialized successfully");
              });
            }}
          >
            {$at("Reinitialize USB Gadget")}
          </AntdButton>
        </SettingsItem>

        <SettingsItem
          title={$at("Reboot System")}
          description={$at("Restart the device system")}
        >
          <AntdButton
            type="primary"
            className={`${isMobile?"w-full":""}`}
            onClick={() => {
              setShowRebootConfirm(true);
            }}
          >
            {$at("Reboot")}
          </AntdButton> 
        </SettingsItem>



        <SettingsItem
          title={$at("Reset Configuration")}
          description={$at("Reset configuration to default. This will log you out.Some configuration changes will take effect after restart system.")}
        >

          <AntdButton

            type="primary"
            className={`${isMobile?"w-full":""}`}
            onClick={() => {
              handleResetConfig();
              window.location.reload();
            }}
          >
            {$at("Reset Config")}
          </AntdButton>
        </SettingsItem>
      </div>

      <ConfirmDialog
        open={showLoopbackWarning}
        onClose={() => {
          setShowLoopbackWarning(false);
        }}
        title="Enable Loopback-Only Mode?"
        description={
          <>
            <p>
              WARNING: This will restrict web interface access to localhost (127.0.0.1)
              only.
            </p>
            <p>Before enabling this feature, make sure you have either:</p>
            <ul className="list-disc space-y-1 pl-5 text-xs text-slate-700 dark:text-slate-300">
              <li>SSH access configured and tested</li>
              <li>Cloud access enabled and working</li>
            </ul>
          </>
        }
        variant="warning"
        confirmText="I Understand, Enable Anyway"
        onConfirm={confirmLoopbackModeEnable}
      />

      <ConfirmDialog
        open={showRebootConfirm}
        onClose={() => {
          setShowRebootConfirm(false);
        }}
        title={$at("Reboot System?")}
        description={
          <>
            <p>
              {$at("Are you sure you want to reboot the system?")}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">
              {$at("The device will restart and you will be disconnected from the web interface.")}
            </p>
          </>
        }
        variant="danger"
        cancelText={$at("Cancel")}
        confirmText={$at("Reboot")}
        onConfirm={() => {
          setShowRebootConfirm(false);
          send("reboot", { force: false }, resp => {
            if ("error" in resp) {
              notifications.error(
                `Failed to reboot: ${resp.error.data || "Unknown error"}`,
              );
              return;
            }
            notifications.success("System rebooting...");
          });
        }}
      />
    </div>
  );
}
