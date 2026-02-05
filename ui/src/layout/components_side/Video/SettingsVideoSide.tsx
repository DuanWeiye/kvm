import { useState, useEffect } from "react";
import { Button as AntdButton , Slider , Checkbox, Select } from "antd";
import { useReactAt } from "i18n-auto-extractor/react";
import { isMobile } from "react-device-detect";

import { TextAreaWithLabel } from "@components/TextArea";
import { useJsonRpc } from "@/hooks/useJsonRpc";
import { useSettingsStore } from "@/hooks/stores";
import { SettingsItem, SettingsItemNew } from "@components/Settings/SettingsView";

import notifications from "../../../notifications";






const defaultEdid =
  "00ffffffffffff0052620188008888881c150103800000780a0dc9a05747982712484c00000001010101010101010101010101010101023a801871382d40582c4500c48e2100001e011d007251d01e206e285500c48e2100001e000000fc00543734392d6648443732300a20000000fd00147801ff1d000a202020202020017b";
const edids = [
  {
    value: defaultEdid.toUpperCase(),
    label: "KVM Default",
  },
  {
    value:
      "00FFFFFFFFFFFF00047265058A3F6101101E0104A53420783FC125A8554EA0260D5054BFEF80714F8140818081C081008B009500B300283C80A070B023403020360006442100001A000000FD00304C575716010A202020202020000000FC0042323436574C0A202020202020000000FF0054384E4545303033383532320A01F802031CF14F90020304050607011112131415161F2309070783010000011D8018711C1620582C250006442100009E011D007251D01E206E28550006442100001E8C0AD08A20E02D10103E9600064421000018C344806E70B028401720A80406442100001E00000000000000000000000000000000000000000000000000000096",
    label: "Acer B246WL, 1920x1200",
  },
  {
    value:
      "00FFFFFFFFFFFF0006B3872401010101021F010380342078EA6DB5A7564EA0250D5054BF6F00714F8180814081C0A9409500B300D1C0283C80A070B023403020360006442100001A000000FD00314B1E5F19000A202020202020000000FC00504132343851560A2020202020000000FF004D314C4D51533035323135370A014D02032AF14B900504030201111213141F230907078301000065030C001000681A00000101314BE6E2006A023A801871382D40582C450006442100001ECD5F80B072B0374088D0360006442100001C011D007251D01E206E28550006442100001E8C0AD08A20E02D10103E960006442100001800000000000000000000000000DC",
    label: "ASUS PA248QV, 1920x1200",
  },
  {
    value:
      "00FFFFFFFFFFFF0010AC132045393639201E0103803C22782ACD25A3574B9F270D5054A54B00714F8180A9C0D1C00101010101010101023A801871382D40582C450056502100001E000000FF00335335475132330A2020202020000000FC0044454C4C204432373231480A20000000FD00384C1E5311000A202020202020018102031AB14F90050403020716010611121513141F65030C001000023A801871382D40582C450056502100001E011D8018711C1620582C250056502100009E011D007251D01E206E28550056502100001E8C0AD08A20E02D10103E960056502100001800000000000000000000000000000000000000000000000000000000004F",
    label: "DELL D2721H, 1920x1080",
  },
];

const streamQualityOptions = [
  { value: "1", label: "High" },
  { value: "0.5", label: "Medium" },
  { value: "0.1", label: "Low" },
];

export default function SettingsVideoSide() {
  const { $at } = useReactAt();
  const [send] = useJsonRpc();
  const [npuAppStatus, setNpuAppStatus] = useState(false);
  const [streamQuality, setStreamQuality] = useState("1");
  const [streamEncodecType, setStreamEncodecType] = useState("avc");
  const [customEdidValue, setCustomEdidValue] = useState<string | null>(null);
  const [edid, setEdid] = useState<string | null>(null);
  const [forceHpd, setForceHpd] = useState(false);

  // Video enhancement settings from store
  const videoSaturation = useSettingsStore(state => state.videoSaturation);
  const setVideoSaturation = useSettingsStore(state => state.setVideoSaturation);
  const videoBrightness = useSettingsStore(state => state.videoBrightness);
  const setVideoBrightness = useSettingsStore(state => state.setVideoBrightness);
  const videoContrast = useSettingsStore(state => state.videoContrast);
  const setVideoContrast = useSettingsStore(state => state.setVideoContrast);

  useEffect(() => {
    send("getNpuAppStatus", {}, resp => {
      if ("error" in resp) return;
      setNpuAppStatus(resp.result as boolean);
    });

    send("getStreamEncodecType", {}, resp => {
      if ("error" in resp) return;
      setStreamEncodecType(resp.result as string);
    });

    send("getStreamQualityFactor", {}, resp => {
      if ("error" in resp) return;
      setStreamQuality(String(resp.result));
    });

    send("getEDID", {}, resp => {
      if ("error" in resp) {
        notifications.error(`Failed to get EDID: ${resp.error.data || "Unknown error"}`);
        return;
      }

      const receivedEdid = resp.result as string;

      const matchingEdid = edids.find(
        x => x.value.toLowerCase() === receivedEdid.toLowerCase(),
      );

      if (matchingEdid) {
        // EDID is stored in uppercase in the UI
        setEdid(matchingEdid.value.toUpperCase());
        // Reset custom EDID value
        setCustomEdidValue(null);
      } else {
        setEdid("custom");
        setCustomEdidValue(receivedEdid);
      }
    });

    send("getForceHpd", {}, resp => {
      if ("error" in resp) {
        notifications.error(`Failed to get force EDID output: ${resp.error.data || "Unknown error"}`);
        setForceHpd(false);
        return;
      }

      setForceHpd(resp.result as boolean);
    });
  }, [send]);

  const handleForceHpdChange = (checked: boolean) => {
    send("setForceHpd", { forceHpd: checked }, resp => {
      if ("error" in resp) {
        notifications.error(`Failed to set force EDID output: ${resp.error.data || "Unknown error"}`);
        setForceHpd(!checked);
        return;
      }

      notifications.success(`Force EDID output ${checked ? "enabled" : "disabled"}`);
      setForceHpd(checked);
    });
  };

  const handleStreamEncodecTypeChange = (encodecType: string) => {
    send("setStreamEncodecType", { encodecType }, resp => {
      if ("error" in resp) {
        notifications.error(
          `Failed to set stream encodec type: ${resp.error.data || "Unknown error"}`,
        );
        return;
      }

      notifications.success(`Stream encodec type set to ${encodecType}`);
      setStreamEncodecType(encodecType);
      window.location.reload();
    });
  };

  const handleStreamQualityChange = (factor: string) => {
    send("setStreamQualityFactor", { factor: Number(factor) }, resp => {
      if ("error" in resp) {
        notifications.error(
          `Failed to set stream quality: ${resp.error.data || "Unknown error"}`,
        );
        return;
      }

      notifications.success(`Stream quality set to ${streamQualityOptions.find(x => x.value === factor)?.label}`);
      setStreamQuality(factor);
    });
  };

  const handleNpuAppStatusChange = (checked: boolean) => {
    send("setNpuAppStatus", { enable: checked }, resp => {
      if ("error" in resp) {
        notifications.error(
          `Failed to set NPU app status: ${resp.error.data || "Unknown error"}`,
        );
        setNpuAppStatus(!checked);
        return;
      }
      
      notifications.success(`NPU app status set to ${checked ? "enabled" : "disabled"}`);
      setNpuAppStatus(checked);
    });
  };

  const handleEDIDChange = (newEdid: string) => {
    send("setEDID", { edid: newEdid }, resp => {
      if ("error" in resp) {
        notifications.error(`Failed to set EDID: ${resp.error.data || "Unknown error"}`);
        return;
      }

      notifications.success(
        `EDID set successfully to ${edids.find(x => x.value === newEdid)?.label}`,
      );
      // Update the EDID value in the UI
      setEdid(newEdid);
    });
  };

  return (
    <div className="space-y-3 "
         onKeyUp={e => e.stopPropagation()}
         onKeyDown={e => e.stopPropagation()}
    >
      <div className="space-y-4">
        <SettingsItem
          title={$at("Encodec Type")}
          description={""}
        >
          <Select
            className={isMobile ? "w-full bg-transparent" : ""}
            value={streamEncodecType}
            options={[
              { value: "avc", label: "H.264 (AVC)" },
              { value: "hevc", label: "H.265 (HEVC)" },
            ]}
            onChange={e => handleStreamEncodecTypeChange(e)}
          />
        </SettingsItem>

        <SettingsItem
          title={$at("Stream Quality")}
          description={""}
        >
          <Select
            className={isMobile ? "w-full bg-transparent" : ""}
            value={streamQuality}
            options={streamQualityOptions}
            onChange={e => handleStreamQualityChange(e)}
          />
        </SettingsItem>


        <SettingsItem
          title={$at("NPU Application")}
          badge="Experimental"
          description={$at("Enable NPU to Object Detection")}
          noCol
          className="flex-row items-center"
        >
          <Checkbox
            checked={npuAppStatus}
            onChange={e => handleNpuAppStatusChange(e.target.checked)}
          />
        </SettingsItem>

        {/* Video Enhancement Settings */}
        <SettingsItem
          title={$at("Video Enhancement")}
          description={$at("Adjust color settings to make the video output more vibrant and colorful")}
        />

        <div className="space-y-4">
          <SettingsItemNew
            title={$at("Saturation")}
            description={`${videoSaturation.toFixed(1)}x`}
            className={"flex-col w-full h-[40px]"}
          >

            <Slider
              min={0.5}
              max={2.0}
              step={0.1}
              value={videoSaturation}
              onChange={value => setVideoSaturation(value)}
              className={"w-full"}
              styles={{
                rail: {
                  borderRadius: '4px'
                },
                track: {
                  borderRadius: '4px'
                }
              }}
            >
            </Slider>
          </SettingsItemNew>

          <SettingsItemNew
            title={$at("Brightness")}
            description={`${videoBrightness.toFixed(1)}x`}
            className={"flex-col w-full h-[40px]"}
          >
            <Slider
              min={0.5}
              max={2.0}
              step={0.1}
              value={videoBrightness}
              onChange={value => setVideoBrightness(value)}
              className={"w-full"}
              styles={{
                rail: {
                  borderRadius: '4px'
                },
                track: {
                  borderRadius: '4px'
                }
              }}
            >
            </Slider>
          </SettingsItemNew>

          <SettingsItemNew
            title={$at("Contrast")}
            description={`${videoContrast.toFixed(1)}x`}
            className={"flex-col w-full h-[40px]"}
          >
            <Slider
              min={0.5}
              max={2.0}
              step={0.1}
              value={videoContrast}
              onChange={value => setVideoContrast(value)}
              className={"w-full"}
              styles={{
                rail: {
                  borderRadius: '4px'
                },
                track: {
                  borderRadius: '4px'
                }
              }}
            >
            </Slider>
          </SettingsItemNew>

          <div className="flex gap-2">
            <AntdButton
              className={"w-full my-2"}
              type={"primary"}
              onClick={() => {
                setVideoSaturation(1.0);
                setVideoBrightness(1.0);
                setVideoContrast(1.0);
              }}
            >{$at("Reset to Default")}</AntdButton>
          </div>
        </div>

        {/* EDID Force Output Setting */}
        <div className="w-full animate-fadeIn opacity-0" style={{ animationDuration: "0.7s", animationDelay: "0.1s" }}>
          <SettingsItem
            title={$at("Force EDID Output")}
            description={$at("Force EDID output even when no display is connected")}
            noCol
            className="flex-row items-center"
          >
            <Checkbox
              checked={forceHpd}
              onChange={e => handleForceHpdChange(e.target.checked)}
            />
          </SettingsItem>
        </div>

        <SettingsItem
          title="EDID"
          description={$at("Adjust the EDID settings for the display")}
        >
          <Select
            className={isMobile ? "w-full bg-transparent" : ""}

            defaultValue={customEdidValue ? "custom" : edid || "asd"}
            value={customEdidValue ? "custom" : edid || "asd"}
            optionLabelProp={"label"}
            onChange={e => {
                  console.log(e)
              if (e === "custom") {
                setEdid("custom");
                setCustomEdidValue("");
              } else {
                setCustomEdidValue(null);
                handleEDIDChange(e);
              }
            }}
            options={[...edids, { value: "custom", label: "Custom" }]}
          />
        {/* options={[...edids, { value: "custom", label: "Custom" }]}*/}
        </SettingsItem>
        {/*<SelectMenuBasic*/}
        {/*  size="SM"*/}
        {/*  label=""*/}
        {/*  fullWidth*/}
        {/*  value={customEdidValue ? "custom" : edid || "asd"}*/}
        {/*  onChange={e => {*/}
        {/*          console.log(e.target.value)*/}
        {/*    if (e.target.value === "custom") {*/}
        {/*      setEdid("custom");*/}
        {/*      setCustomEdidValue("");*/}
        {/*    } else {*/}
        {/*      setCustomEdidValue(null);*/}
        {/*      handleEDIDChange(e.target.value as string);*/}
        {/*    }*/}
        {/*  }}*/}
        {/*  options={[...edids, { value: "custom", label: "Custom" }]}*/}
        {/*/>*/}

        {customEdidValue !== null && (
          <>
            <SettingsItem
              title={$at("Custom EDID")}
              description={$at("EDID details video mode compatibility. Default settings works in most cases, but unique UEFI/BIOS might need adjustments.")}
            />
            <TextAreaWithLabel
              label={$at("EDID File")}
              placeholder="00F..."
              rows={3}
              value={customEdidValue}
              onChange={e => setCustomEdidValue(e.target.value)}
            />
            <div className="flex justify-start gap-x-2">
              <AntdButton
                type="primary"
                onClick={() => handleEDIDChange(customEdidValue)}
              >{$at("Set Custom EDID")}</AntdButton>
              <AntdButton
                className={"border-2"}
                style={{
                  background: "transparent",
                  borderColor: "rgba(28,168,0,1)",
                  whiteSpace: "nowrap",
                }}
                onClick={() => {
                  setCustomEdidValue(null);
                  handleEDIDChange(defaultEdid.toUpperCase());
                }}

              ><div  className={"text-[rgba(28,168,0,1)]"}>{$at("Restore to default")}</div></AntdButton>
            </div>
          </>
        )}
      </div>
      <div className={"h-[10vh]"}></div>
    </div>
  );
}