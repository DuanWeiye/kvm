import React, { useEffect, useState } from "react";
import { LuVolume2, LuVolumeX } from "react-icons/lu";
import clsx from "clsx";
import { Slider } from "antd";
import { createStyles } from 'antd-style';
import { isMobile } from "react-device-detect";

import { cva, cx } from "@/cva.config";
import { button_primary_color, dark_bd_style } from "@/layout/theme_color";

interface VolumeControlProps {
  theme?: "primary" | "danger" | "light" | "lightDanger" | "blank";
  size?: "XS" | "SM" | "MD" | "LG" | "XL";
  fullWidth?: boolean;
  className?: string;
}

const sizes = {
  XS: "h-[28px] px-2 text-xs",
  SM: "h-[36px] px-3 text-[13px]",
  MD: "h-[40px] px-3.5 text-sm",
  LG: "h-[48px] px-4 text-base",
  XL: "h-[56px] px-5 text-base",
};

const themes = {
  primary: cx(
    // Base styles
    "bg-blue-700 dark:border-blue-600 border border-blue-900/60 text-white shadow-sm",
    // Hover states
    "group-hover:bg-blue-800",
    // Active states
    "group-active:bg-blue-900",
  ),
  danger: cx(
    // Base styles
    "bg-red-600 text-white border-red-700 shadow-xs shadow-red-200/80 dark:border-red-600 dark:shadow-red-900/20",
    // Hover states
    "group-hover:bg-red-700 group-hover:border-red-800 dark:group-hover:bg-red-700 dark:group-hover:border-red-600",
    // Active states
    "group-active:bg-red-800 dark:group-active:bg-red-800",
    // Focus states
    "group-focus:ring-red-700 dark:group-focus:ring-red-600",
  ),
  light: cx(
    // Base styles
    "bg-white text-black border-slate-800/30 shadow-xs dark:bg-slate-800 dark:border-slate-300/20 dark:text-white",
    // Hover states
    "group-hover:bg-blue-50/80 dark:group-hover:bg-slate-700",
    // Active states
    "group-active:bg-blue-100/60 dark:group-active:bg-slate-600",
    // Disabled states
    "group-disabled:group-hover:bg-white dark:group-disabled:group-hover:bg-slate-800",
  ),
  lightDanger: cx(
    // Base styles
    "bg-white text-black border-red-400/60 shadow-xs",
    // Hover states
    "group-hover:bg-red-50/80",
    // Active states
    "group-active:bg-red-100/60",
    // Focus states
    "group-focus:ring-red-700",
  ),
  blank: cx(
    // Base styles
    "bg-white/0 text-black border-transparent dark:text-white",
    // Hover states
    "group-hover:bg-white group-hover:border-slate-800/30 group-hover:shadow-sm dark:group-hover:bg-slate-700 dark:group-hover:border-slate-600",
    // Active states
    "group-active:bg-slate-100/80",
  ),
};

const iconVariants = cva({
  variants: {
    size: {
      XS: "h-3.5",
      SM: "h-3.5",
      MD: "h-5",
      LG: "h-6",
      XL: "h-6",
    },
    theme: {
      primary: "text-white",
      danger: "text-white ",
      light: "text-black dark:text-white",
      lightDanger: "text-black dark:text-white",
      blank: "text-black dark:text-white",
    },
  },
});

const useStyles = createStyles(({ css }) => ({
  myCustomSlider: css`
    .ant-slider-handle:hover::after,
    .ant-slider-handle:hover::before,
    .ant-slider-handle:active::after,
    .ant-slider-handle:focus::after,
    .ant-slider-handle::after {
      width: 14px;
      height: 14px;
      inset-inline-start: 0;
      inset-block-start: 0;
      outline: none;
      box-shadow: none;
      border-radius: 50%;
      margin-top: -2px;
    }
  `,
}));

const VolumeControl: React.FC<VolumeControlProps> = ({
                                                       theme = "light",
                                                       size = "XS",
                                                       fullWidth = false,
                                                       className,
                                                     }) => {
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(true);
  // const [showSlider, setShowSlider] = useState(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const { styles } = useStyles();
  useEffect(() => {
    const audio = document.querySelector("audio#global-audio") as HTMLAudioElement | null;
    setAudioElement(audio);
    if (audio) {
      const savedVolume = parseFloat(localStorage.getItem("audioVolume") || "1");
      const savedMuted = localStorage.getItem("audioMuted") === "true";

      audio.volume = savedVolume;
      audio.muted = savedMuted;
      setVolume(savedVolume);
      setMuted(savedMuted);

      audio
        .play()
        .catch(() => {
          audio.muted = true;
          setMuted(true);
        });
    }
  }, []);

  const handlePlay = () => {
    if (!audioElement) return;
    audioElement.muted = false;
    audioElement.volume = volume;
    audioElement.play().catch((err) => {
      console.warn("Failed to play:", err);
    });
    setMuted(false);
  };

  const handleVolumeChange = (newVolume: number) => {
    // const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    setMuted(newVolume === 0);
    if (audioElement) {
      audioElement.volume = newVolume;
      audioElement.muted = newVolume === 0;
    }
    localStorage.setItem("audioVolume", String(newVolume));
    localStorage.setItem("audioMuted", String(newVolume === 0));
  };

  const iconClass = iconVariants({ theme, size });

  return (
    <div
      className={clsx(
        "relative group flex items-center",
        fullWidth ? "w-full" : "w-fit",
        className
      )}
    >
      <div
        onClick={handlePlay}
      >
        {muted || volume === 0 ? (
          <LuVolumeX className={clsx(iconClass, "shrink-0")} />
        ) : (
          <LuVolume2 className={clsx(iconClass, "shrink-0")} />
        )}
      </div>

      <div
        className={clsx(
          "transition-all duration-300 ease-in-out ",
          "flex-1 opacity-100 ml-2 px-2"
        )}
      >
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          onChange={handleVolumeChange}
          className={`${styles.myCustomSlider} h-full !m-0 ${isMobile ? "w-full" : "w-[100px]"}`}
          classNames={{
            rail: `${dark_bd_style} !rounded-md`,
            track:`${button_primary_color} !rounded-md`,
            handle: `${button_primary_color} rounded-full`,
          }}
        />
      </div>
    </div>
  );
};

export default VolumeControl;