
import { useCallback, useEffect, useRef, useState } from "react";
import { Button as AntdButton, Checkbox, Select } from "antd";
import { useReactAt } from "i18n-auto-extractor/react";
import { CheckCircleIcon } from "@heroicons/react/20/solid";
import { isMobile } from "react-device-detect";

import { useJsonRpc } from "@/hooks/useJsonRpc";
import { SettingsPageHeader } from "@components/Settings/SettingsPageheader";
import { SettingsItem } from "@components/Settings/SettingsView";
import Card from "@components/Card";
import LoadingSpinner from "@components/LoadingSpinner";
import { Button } from "@components/Button";
import { InputFieldWithLabel } from "@components/InputField";
import { UpdateState, useDeviceStore, useUpdateStore } from "@/hooks/stores";
import notifications from "@/notifications";

export interface SystemVersionInfo {
  local: { appVersion: string; systemVersion: string };
  remote?: { appVersion: string; systemVersion: string };
  systemUpdateAvailable: boolean;
  appUpdateAvailable: boolean;
  error?: string;
}

export interface LocalVersionInfo {
  appVersion: string;
  systemVersion: string;
}

export default function SettingsVersion() {
  const [send] = useJsonRpc();
  const [autoUpdate, setAutoUpdate] = useState(true);
  const { $at } = useReactAt();
  const { setModalView, otaState } = useUpdateStore();
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);
  const updatePanelRef = useRef<HTMLDivElement | null>(null);
  const [updateSource, setUpdateSource] = useState("github");
  const [customUpdateBaseURL, setCustomUpdateBaseURL] = useState("");

  const currentVersions = useDeviceStore(state => {
    const { appVersion, systemVersion } = state;
    if (!appVersion || !systemVersion) return null;
    return { appVersion, systemVersion };
  });

  useEffect(() => {
    send("getAutoUpdateState", {}, resp => {
      if ("error" in resp) return;
      setAutoUpdate(resp.result as boolean);
    });
  }, [send]);

  useEffect(() => {
    send("getCustomUpdateBaseURL", {}, resp => {
      if ("error" in resp) return;
      setCustomUpdateBaseURL(resp.result as string);
    });
  }, [send]);

  const handleAutoUpdateChange = (enabled: boolean) => {
    send("setAutoUpdateState", { enabled }, resp => {
      if ("error" in resp) {
        notifications.error(
          `Failed to set auto-update: ${resp.error.data || "Unknown error"}`,
        );
        return;
      }
      setAutoUpdate(enabled);
    });
  };

  const applyUpdateSource = useCallback(
    (source: string) => {
      send("setUpdateSource", { source }, resp => {
        if ("error" in resp) {
          notifications.error(`Failed to set update source: ${resp.error.data || "Unknown error"}`);
          return;
        }
        notifications.success(
          `Update source set to ${updateSourceOptions.find(x => x.value === source)?.label}`,
        );
        setUpdateSource(source);
      });
    },
    [send],
  );

  const applyCustomUpdateBaseURL = useCallback(() => {
    send("setCustomUpdateBaseURL", { baseURL: customUpdateBaseURL }, resp => {
      if ("error" in resp) {
        notifications.error(`Failed to save custom base URL: ${resp.error.data || "Unknown error"}`);
        return;
      }
      notifications.success("Custom base URL applied");
    });
  }, [customUpdateBaseURL, send]);

  const closeUpdateDialog = useCallback(() => {
    setIsUpdateDialogOpen(false);
  }, []);

  const openUpdatePanel = useCallback(() => {
    setIsUpdateDialogOpen(true);
    setModalView("loading");
    setTimeout(() => updatePanelRef.current?.scrollIntoView({ block: "nearest" }), 0);
  }, [setModalView]);

  const checkForUpdates = useCallback(() => {
    if (updateSource === "custom") {
      send("setCustomUpdateBaseURL", { baseURL: customUpdateBaseURL }, resp => {
        if ("error" in resp) {
          notifications.error(
            `Failed to set custom base URL: ${resp.error.data || "Unknown error"}`,
          );
          return;
        }
        send("setUpdateSource", { source: updateSource }, resp2 => {
          if ("error" in resp2) {
            notifications.error(
              `Failed to set update source: ${resp2.error.data || "Unknown error"}`,
            );
            return;
          }
          openUpdatePanel();
        });
      });
      return;
    }

    send("setUpdateSource", { source: updateSource }, resp => {
      if ("error" in resp) {
        notifications.error(`Failed to set update source: ${resp.error.data || "Unknown error"}`);
        return;
      }
      openUpdatePanel();
    });
  }, [customUpdateBaseURL, openUpdatePanel, send, updateSource]);

  const onConfirmUpdate = useCallback(() => {
    send("tryUpdate", {});
    setModalView("updating");
  }, [send, setModalView]);

  useEffect(() => {
    if (!isUpdateDialogOpen) return;
    if (otaState.updating) {
      setModalView("updating");
    } else if (otaState.error) {
      setModalView("error");
    } else {
      setModalView("loading");
    }
  }, [isUpdateDialogOpen, otaState.updating, otaState.error, setModalView]);

  return (
    <div className="space-y-4">
      <SettingsPageHeader
        title={$at("Version")}
        description={$at("Check the versions of the system and applications")}
      />

      <div className="space-y-4">
        <div className="space-y-4 pb-2">
          <SettingsItem
            title={""}
            description={
              currentVersions ? (
                <>
                  {$at("AppVersion")}: {currentVersions.appVersion}
                  <br />
                  {$at("SystemVersion")}: {currentVersions.systemVersion}
                </>
              ) : (
                <>
                  {$at("AppVersion: Loading...")}
                  <br />
                  {$at("SystemVersion: Loading...")}
                </>
              )
            }
          />

          <UpdateSourceSettings
            updateSource={updateSource}
            onUpdateSourceChange={applyUpdateSource}
            customUpdateBaseURL={customUpdateBaseURL}
            onCustomUpdateBaseURLChange={setCustomUpdateBaseURL}
            onSaveCustomUpdateBaseURL={applyCustomUpdateBaseURL}
          />

          <div className="flex items-center justify-start">
            <AntdButton type="primary" onClick={checkForUpdates} className={isMobile ? "w-full" : ""}>
              {$at("Check for Updates")}
            </AntdButton>
          </div>

          <div className="hidden">
            <SettingsItem
              title={$at("Auto Update")}
              description={$at("Automatically update the device to the latest version")}
            >
              <Checkbox
                checked={autoUpdate}
                onChange={e => {
                  handleAutoUpdateChange(e.target.checked);
                }}
              />
            </SettingsItem>
          </div>

          {isUpdateDialogOpen && (
            <div ref={updatePanelRef} className="pt-2">
              <UpdateContent onClose={closeUpdateDialog} onConfirmUpdate={onConfirmUpdate} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const updateSourceOptions = [
  //{ value: "cdn", label: "CDN" },
  { value: "github", label: "github" },
  //{ value: "gitee", label: "gitee" },
  { value: "custom", label: "custom" },
];

function UpdateSourceSettings({
  updateSource,
  onUpdateSourceChange,
  customUpdateBaseURL,
  onCustomUpdateBaseURLChange,
  onSaveCustomUpdateBaseURL,
}: {
  updateSource: string;
  onUpdateSourceChange: (source: string) => void;
  customUpdateBaseURL: string;
  onCustomUpdateBaseURLChange: (baseURL: string) => void;
  onSaveCustomUpdateBaseURL: () => void;
}) {
  const { $at } = useReactAt();
  return (
    <div className="space-y-4">
      <SettingsItem
        title={$at("Update Source")}
        description={$at("Select the update source")}
      >
        <Select
          value={updateSource}
          className={`${isMobile?"w-full":"h-[36px] w-[22%]"}`}
          options={updateSourceOptions.map(opt => ({
            ...opt,
            label: $at(opt.label),
          }))}
          onChange={e => onUpdateSourceChange(e)}
        />
      </SettingsItem>
      {updateSource === "custom" && (
        <div className="flex items-end gap-x-2">
          <InputFieldWithLabel
            size="SM"
            label="Custom Base URL"
            value={customUpdateBaseURL}
            onChange={e => onCustomUpdateBaseURLChange(e.target.value)}
            placeholder="temp_url:picokvm.top/luckfox_picokvm_firmware/lastest/"
          />
          <AntdButton type="primary" onClick={onSaveCustomUpdateBaseURL}>
            {$at("Apply")}
          </AntdButton>
        </div>
      )}
    </div>
  );
}

function UpdateContent({
  onClose,
  onConfirmUpdate,
}: {
  onClose: () => void;
  onConfirmUpdate: () => void;
}) {
  const [versionInfo, setVersionInfo] = useState<null | SystemVersionInfo>(null);
  const { modalView, setModalView, otaState } = useUpdateStore();
  const [send] = useJsonRpc();

  const onFinishedLoading = useCallback(
    async (info: SystemVersionInfo) => {
      const hasUpdate = info?.systemUpdateAvailable || info?.appUpdateAvailable;

      setVersionInfo(info);

      if (hasUpdate) {
        setModalView("updateAvailable");
      } else {
        setModalView("upToDate");
      }
    },
    [setModalView],
  );

  useEffect(() => {
    setVersionInfo(null);
  }, [setModalView]);

  return (
    <div className="text-left">
      {modalView === "error" && (
        <UpdateErrorState
          errorMessage={otaState.error}
          onClose={onClose}
          onRetryUpdate={() => setModalView("loading")}
        />
      )}

      {modalView === "loading" && (
        <LoadingState onFinished={onFinishedLoading} onCancelCheck={onClose} />
      )}

      {modalView === "updateAvailable" && (
        <UpdateAvailableState
          onConfirmUpdate={onConfirmUpdate}
          onClose={onClose}
          versionInfo={versionInfo!}
        />
      )}

      {modalView === "updating" && (
        <UpdatingDeviceState otaState={otaState} onMinimizeUpgradeDialog={onClose} />
      )}

      {modalView === "upToDate" && (
        <SystemUpToDateState
          checkUpdate={() => setModalView("loading")}
          onClose={onClose}
        />
      )}

      {modalView === "updateCompleted" && <UpdateCompletedState onClose={onClose} />}
    </div>
  );
}

function LoadingState({
  onFinished,
  onCancelCheck,
}: {
  onFinished: (versionInfo: SystemVersionInfo) => void;
  onCancelCheck: () => void;
}) {
  const { $at } = useReactAt();
  const [progressWidth, setProgressWidth] = useState("0%");
  const abortControllerRef = useRef<AbortController | null>(null);
  const [send] = useJsonRpc();

  const setAppVersion = useDeviceStore(state => state.setAppVersion);
  const setSystemVersion = useDeviceStore(state => state.setSystemVersion);

  const getVersionInfo = useCallback(() => {
    return new Promise<SystemVersionInfo>((resolve, reject) => {
      send("getUpdateStatus", {}, async resp => {
        if ("error" in resp) {
          notifications.error(`Failed to check for updates: ${resp.error}`);
          reject(new Error("Failed to check for updates"));
        } else {
          const result = resp.result as SystemVersionInfo;
          setAppVersion(result.local.appVersion);
          setSystemVersion(result.local.systemVersion);

          if (result.error) {
            notifications.error(`Failed to check for updates: ${result.error}`);
            reject(new Error("Failed to check for updates"));
          } else {
            resolve(result);
          }
        }
      });
    });
  }, [send, setAppVersion, setSystemVersion]);

  const progressBarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setProgressWidth("0%");

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    const animationTimer = setTimeout(() => {
      setProgressWidth("100%");
    }, 0);

    getVersionInfo()
      .then(versionInfo => {
        return new Promise(resolve => setTimeout(() => resolve(versionInfo), 600));
      })
      .then(versionInfo => {
        if (!signal.aborted) {
          onFinished(versionInfo as SystemVersionInfo);
        }
      })
      .catch(error => {
        if (!signal.aborted) {
          console.error("LoadingState: Error fetching version info", error);
        }
      });

    return () => {
      clearTimeout(animationTimer);
      abortControllerRef.current?.abort();
    };
  }, [getVersionInfo, onFinished]);

  return (
    <div className="flex flex-col items-stretch justify-start space-y-4 text-left">
      <div className="space-y-4">
        <div className="space-y-0">
          <p className="text-base font-semibold text-black dark:text-white">
            {$at("Checking for updates...")}
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {$at("We're ensuring your device has the latest features and improvements.")}
          </p>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-300">
          <div
            ref={progressBarRef}
            style={{ width: progressWidth }}
            className="h-2.5 bg-[rgba(22,152,217,1)] dark:bg-[rgba(45,106,229,1)] transition-all duration-1000 ease-in-out"
          ></div>
        </div>
        <div className="mt-4">
          <AntdButton type="primary" onClick={onCancelCheck}>
            {$at("Cancel")}
          </AntdButton>
        </div>
      </div>
    </div>
  );
}

function UpdatingDeviceState({
  otaState,
  onMinimizeUpgradeDialog,
}: {
  otaState: UpdateState["otaState"];
  onMinimizeUpgradeDialog: () => void;
}) {
  const formatProgress = (progress: number) => `${Math.round(progress)}%`;

  const calculateOverallProgress = (type: "system" | "app") => {
    const downloadProgress = (otaState[`${type}DownloadProgress`] ?? 0) * 100;
    const updateProgress = (otaState[`${type}UpdateProgress`] ?? 0) * 100;
    const verificationProgress = (otaState[`${type}VerificationProgress`] ?? 0) * 100;

    if (!downloadProgress && !updateProgress && !verificationProgress) {
      return 0;
    }

    console.log(
      `For ${type}:\n` +
        `  Download Progress: ${downloadProgress}% (${otaState[`${type}DownloadProgress`]})\n` +
        `  Update Progress: ${updateProgress}% (${otaState[`${type}UpdateProgress`]})\n` +
        `  Verification Progress: ${verificationProgress}% (${otaState[`${type}VerificationProgress`]})`,
    );

    if (type === "app") {
      return Math.min(
        downloadProgress * 0.55 + verificationProgress * 0.54 + updateProgress * 0.01,
        100,
      );
    } else {
      return Math.min(
        downloadProgress * 0.4 + verificationProgress * 0.1 + updateProgress * 0.5,
        100,
      );
    }
  };

  const getUpdateStatus = (type: "system" | "app") => {
    const downloadFinishedAt = otaState[`${type}DownloadFinishedAt`];
    const verfiedAt = otaState[`${type}VerifiedAt`];
    const updatedAt = otaState[`${type}UpdatedAt`];

    if (!otaState.metadataFetchedAt) {
      return "Fetching update information...";
    } else if (!downloadFinishedAt) {
      return `Downloading ${type} update...`;
    } else if (!verfiedAt) {
      return `Verifying ${type} update...`;
    } else if (!updatedAt) {
      return `Installing ${type} update...`;
    } else {
      return `Awaiting reboot`;
    }
  };

  const isUpdateComplete = (type: "system" | "app") => {
    return !!otaState[`${type}UpdatedAt`];
  };

  const areAllUpdatesComplete = () => {
    if (otaState.systemUpdatePending && otaState.appUpdatePending) {
      return isUpdateComplete("system") && isUpdateComplete("app");
    }
    return (
      (otaState.systemUpdatePending && isUpdateComplete("system")) ||
      (otaState.appUpdatePending && isUpdateComplete("app"))
    );
  };
  const { $at } = useReactAt();
  return (
    <div className="flex flex-col items-start justify-start space-y-4 text-left">
      <div className="w-full space-y-4">
        <div className="space-y-0">
          <p className="text-base font-semibold text-black dark:text-white">
            {$at("Updating your device")}
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {$at("Please don't turn off your device. This process may take a few minutes.")}
          </p>
        </div>
        <Card className="space-y-4 p-4">
          {areAllUpdatesComplete() ? (
            <div className="my-2 flex flex-col items-center space-y-2 text-center">
              <LoadingSpinner className="h-6 w-6 text-[rgba(22,152,217,1)] dark:text-[rgba(45,106,229,1)]" />
              <div className="flex justify-between text-sm text-slate-600 dark:text-slate-300">
                <span className="font-medium text-black dark:text-white">
                  {$at("Rebooting to complete the update...")}
                </span>
              </div>
            </div>
          ) : (
            <>
              {!(otaState.systemUpdatePending || otaState.appUpdatePending) && (
                <div className="my-2 flex flex-col items-center space-y-2 text-center">
                  <LoadingSpinner className="h-6 w-6 text-[rgba(22,152,217,1)] dark:text-[rgba(45,106,229,1)]" />
                </div>
              )}

              {otaState.systemUpdatePending && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-black dark:text-white">
                      {$at("Linux System Update")}
                    </p>
                    {calculateOverallProgress("system") < 100 ? (
                      <LoadingSpinner className="h-4 w-4 text-[rgba(22,152,217,1)] dark:text-[rgba(45,106,229,1)]" />
                    ) : (
                      <CheckCircleIcon className="h-4 w-4 text-[rgba(22,152,217,1)] dark:text-[rgba(45,106,229,1)]" />
                    )}
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-300 dark:bg-slate-600">
                    <div
                      className="h-2.5 rounded-full bg-[rgba(22,152,217,1)] transition-all duration-500 ease-linear dark:bg-[rgba(45,106,229,1)]"
                      style={{
                        width: formatProgress(calculateOverallProgress("system")),
                      }}
                    ></div>
                  </div>
                  <div className="flex justify-between text-sm text-slate-600 dark:text-slate-300">
                    <span>{getUpdateStatus("system")}</span>
                    {calculateOverallProgress("system") < 100 ? (
                      <span>{formatProgress(calculateOverallProgress("system"))}</span>
                    ) : null}
                  </div>
                </div>
              )}
              {otaState.appUpdatePending && (
                <>
                  {otaState.systemUpdatePending && (
                    <hr className="dark:border-slate-600" />
                  )}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-black dark:text-white">
                        {$at("App Update")}
                      </p>
                      {calculateOverallProgress("app") < 100 ? (
                        <LoadingSpinner className="h-4 w-4 text-[rgba(22,152,217,1)] dark:text-[rgba(45,106,229,1)]" />
                      ) : (
                        <CheckCircleIcon className="h-4 w-4 text-[rgba(22,152,217,1)] dark:text-[rgba(45,106,229,1)]" />
                      )}
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-300 dark:bg-slate-600">
                      <div
                        className="h-2.5 rounded-full bg-[rgba(22,152,217,1)] transition-all duration-500 ease-linear dark:bg-[rgba(45,106,229,1)]"
                        style={{
                          width: formatProgress(calculateOverallProgress("app")),
                        }}
                      ></div>
                    </div>
                    <div className="flex justify-between text-sm text-slate-600 dark:text-slate-300">
                      <span>{getUpdateStatus("app")}</span>
                      {calculateOverallProgress("app") < 100 ? (
                        <span>{formatProgress(calculateOverallProgress("app"))}</span>
                      ) : null}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </Card>
        <div className="mt-4 flex justify-start gap-x-2 text-white">
          <AntdButton
            type="primary"
            onClick={onMinimizeUpgradeDialog}
          >
            {$at("Update in Background")}
          </AntdButton>
        </div>
      </div>
    </div>
  );
}

function SystemUpToDateState({
  checkUpdate,
  onClose,
}: {
  checkUpdate: () => void;
  onClose: () => void;
}) {
  const { $at } = useReactAt();
  return (
    <div className="flex flex-col items-start justify-start space-y-4 text-left">
      <div className="text-left">
        <p className="text-base font-semibold text-black dark:text-white">
          {$at("System is up to date")}
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {$at("Your system is running the latest version. No updates are currently available.")}
        </p>

        <div className="mt-4 flex gap-x-2">
          <AntdButton type="primary" onClick={checkUpdate}>
            {$at("Check Again")}
          </AntdButton>
          <AntdButton type="primary" onClick={onClose}>
            {$at("Back")}
          </AntdButton>
        </div>
      </div>
    </div>
  );
}

function UpdateAvailableState({
  versionInfo,
  onConfirmUpdate,
  onClose,
}: {
  versionInfo: SystemVersionInfo;
  onConfirmUpdate: () => void;
  onClose: () => void;
}) {
  const { $at } = useReactAt();
  return (
    <div className="flex flex-col items-start justify-start space-y-4 text-left">
      <div className="w-full space-y-4">
        <div className="space-y-0">
          <p className="text-base font-semibold text-black dark:text-white">
            {$at("Update available")}
          </p>
          <p className="mb-2 text-sm text-slate-600 dark:text-slate-300">
            {$at("A new update is available to enhance system performance and improve compatibility. We recommend updating to ensure everything runs smoothly.")}
          </p>
          <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
            {versionInfo?.systemUpdateAvailable ? (
              <>
                <span className="font-semibold">System:</span> {versionInfo?.remote?.systemVersion}
                <br />
              </>
            ) : null}
            {versionInfo?.appUpdateAvailable ? (
              <>
                <span className="font-semibold">App:</span> {versionInfo?.remote?.appVersion}
              </>
            ) : null}
          </p>

          <div className="space-y-4">
            <div className="flex items-center justify-start gap-x-2">
              <AntdButton type="primary" onClick={onConfirmUpdate}>
                {$at("Update Now")}
              </AntdButton>
              <AntdButton type="primary" onClick={onClose}>
                {$at("Do it later")}
              </AntdButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function UpdateCompletedState({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col items-start justify-start space-y-4 text-left">
      <div className="text-left">
        <p className="text-base font-semibold dark:text-white">
          Update Completed Successfully
        </p>
        <p className="mb-4 text-sm text-slate-600 dark:text-[#ffffff]">
          Your device has been successfully updated to the latest version. Enjoy the new features
          and improvements!
        </p>
        <div className="flex items-center justify-start">
          <Button size="SM" theme="primary" text="Back" onClick={onClose} />
        </div>
      </div>
    </div>
  );
}

function UpdateErrorState({
  errorMessage,
  onClose,
  onRetryUpdate,
}: {
  errorMessage: string | null;
  onClose: () => void;
  onRetryUpdate: () => void;
}) {
  const { $at } = useReactAt();
  return (
    <div className="flex flex-col items-start justify-start space-y-4 text-left">
      <div className="text-left">
        <p className="text-base font-semibold dark:text-white">
          {$at("Update Error")}
        </p>
        <p className="mb-4 text-sm text-slate-600 dark:text-[#ffffff]">
          {$at("An error occurred while updating your device. Please try again later.")}
        </p>
        {errorMessage && (
          <p className="mb-4 text-sm font-medium text-red-600 dark:text-red-400">
            {$at("Error details:")} {errorMessage}
          </p>
        )}
        <div className="flex items-center justify-start gap-x-2">
          <AntdButton type="primary" onClick={onClose}>
            {$at("Back")}
          </AntdButton>
          <AntdButton type="primary" onClick={onRetryUpdate}>
            {$at("Retry")}
          </AntdButton>
        </div>
      </div>
    </div>
  );
}
