import React, { useEffect, useRef, useState } from "react";
import { BsMouseFill, BsLockFill, BsUnlockFill } from "react-icons/bs";
import { useReactAt } from "i18n-auto-extractor/react";

import VirtualKeyboard from "@components/VirtualKeyboard";
import {
  HDMIErrorOverlay,
  LoadingVideoOverlay,
  NoAutoplayPermissionsOverlay,
  PointerLockBar,
} from "@components/VideoOverlay";
import { cx } from "@/cva.config";
import { useVideoEffects } from "@/layout/core/desktop/hooks/useVideoEffects";
import { useVideoStream } from "@/layout/core/desktop/hooks/useVideoStream";
import { usePointerLock } from "@/layout/core/desktop/hooks/usePointerLock";
import { useFullscreen } from "@/layout/core/desktop/hooks/useFullscreen";
import { useKeyboardEvents } from "@/layout/core/desktop/hooks/useKeyboardEvents";
import { useMouseEvents } from "@/layout/core/desktop/hooks/useMouseEvents";
import { useVideoOverlays } from "@/layout/core/desktop/hooks/useVideoOverlays";
import { VideoContainer } from "@components/Video/VideoContainer";
import { VideoElement } from "@components/Video/VideoElement";
import StatsTobbar from "@components/Sidebar/StatsTopbar";
import KeyboardPanel from "@/layout/components_bottom/keyboard/KeyboardPanel";
import Clipboard from "@/layout/components_side/Clipboard/Clipboard";
import SettingsModal from "@/layout/components_setting";
import  { MacroMoreList } from "@/layout/components_side/Macros/MacroTopBar";
import { useMacrosSideTitleState , useHidStore, useMouseStore, useSettingsStore } from "@/hooks/stores";
import MobileTerminal from "@/layout/components_bottom/terminal/index.mobile";
import { dark_bg_desktop, dark_bg_style_fun } from "@/layout/theme_color";
import PowerControl from "@/layout/components_side/Power";
import MousePanel from "@components/MousePanel";
import EnhancedDrawer from "@components/Sidebar/SidebarDrawer";
import SettingsVideoSide from "@/layout/components_side/Video/SettingsVideoSide";
import ConnectionStatsSidebar from "@components/ConnectionStats";
import { useTheme } from "@/layout/contexts/ThemeContext";
import SettingsMacros from "@/layout/components_side/Macros";
import { useTouchZoom } from "@/layout/core/desktop/hooks/useTouchZoom";
import { usePasteHandler } from "@/layout/core/desktop/hooks/usePasteHandler";
import UsbEpModeSelect from "@/layout/components_bottom/usbepmode/UsbEpModeSelect";
import VirtualMediaSource from "@/layout/components_side/VirtualMediaSource";
import { useJsonRpc } from "@/hooks/useJsonRpc";

export default function MobileDesktop({ isFullscreen }: { isFullscreen?: number }) {
  const { $at } = useReactAt();
  const { isDark } = useTheme();
  const videoElm = useRef<HTMLVideoElement>(null);
  const audioElm = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomContainerRef = useRef<HTMLDivElement>(null);
  const pasteCaptureRef = useRef<HTMLTextAreaElement>(null);
  const isReinitializingGadget = useHidStore(state => state.isReinitializingGadget);
  const macrosSideTitle = useMacrosSideTitleState(state => state.sideTitle);

  const videoEffects = useVideoEffects();
  const videoStream = useVideoStream(videoElm as React.RefObject<HTMLVideoElement>, audioElm as React.RefObject<HTMLAudioElement>);
  const pointerLock = usePointerLock(videoElm as React.RefObject<HTMLVideoElement>);
  useFullscreen(videoElm as React.RefObject<HTMLVideoElement>, pointerLock, isFullscreen);
  const touchZoom = useTouchZoom(zoomContainerRef as React.RefObject<HTMLDivElement>);
  const { handleGlobalPaste } = usePasteHandler(pasteCaptureRef as React.RefObject<HTMLTextAreaElement>);
  const keyboardEvents = useKeyboardEvents(pasteCaptureRef as React.RefObject<HTMLTextAreaElement>, isReinitializingGadget);
  const [showVirtualMouseButtons, setShowVirtualMouseButtons] = useState(false);
  const [lockedButtons, setLockedButtons] = useState(0);
  const mouseEvents = useMouseEvents(videoElm as React.RefObject<HTMLVideoElement>, pointerLock, touchZoom, showVirtualMouseButtons, lockedButtons);
  const overlays = useVideoOverlays(videoStream, pointerLock, videoEffects);

  const forceHttp = useSettingsStore(state => state.forceHttp);
  const mouseX = useMouseStore(state => state.mouseX);
  const mouseY = useMouseStore(state => state.mouseY);
  const [send] = useJsonRpc();
  const [leftBtnPos, setLeftBtnPos] = useState({ x: 40, y: 40 });
  const [rightBtnPos, setRightBtnPos] = useState({ x: 120, y: 40 });
  const [leftLockPos, setLeftLockPos] = useState({ x: 40, y: 110 });
  const [rightLockPos, setRightLockPos] = useState({ x: 120, y: 110 });

  const [draggingBtn, setDraggingBtn] = useState<"left" | "right" | "leftLock" | "rightLock" | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  
  const activeButtonsRef = useRef(0);
  
  useEffect(() => {
    if (isFullscreen) {
      setShowVirtualMouseButtons(false);
    }
  }, [isFullscreen]);

  const updateButtons = (mask: number, isDown: boolean) => {
    if (isReinitializingGadget) return;
    
    let newButtons = activeButtonsRef.current;
    if (isDown) {
        newButtons |= mask;
    } else {
        newButtons &= ~mask;
    }
    
    if (!isDown && (lockedButtons & mask)) {
        setLockedButtons(prev => prev & ~mask);
    }

    activeButtonsRef.current = newButtons;
    send("absMouseReport", { x: mouseX, y: mouseY, buttons: newButtons });
  };
  
  const toggleLock = (mask: number) => {
     if (isReinitializingGadget) return;
     const isLocked = (lockedButtons & mask) !== 0;
     let newButtons = activeButtonsRef.current;
     
     if (isLocked) {
         setLockedButtons(prev => prev & ~mask);
         newButtons &= ~mask;
     } else {
         setLockedButtons(prev => prev | mask);
         newButtons |= mask;
     }
     
     activeButtonsRef.current = newButtons;
     send("absMouseReport", { x: mouseX, y: mouseY, buttons: newButtons });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>, type: "left" | "right" | "leftLock" | "rightLock") => {
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    dragOffset.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    setDraggingBtn(type);
    target.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingBtn) return;
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const x = e.clientX - containerRect.left - dragOffset.current.x;
    const y = e.clientY - containerRect.top - dragOffset.current.y;
    const clampedX = Math.max(0, Math.min(containerRect.width - 56, x));
    const clampedY = Math.max(0, Math.min(containerRect.height - 56, y));
    if (draggingBtn === "left") {
      setLeftBtnPos({ x: clampedX, y: clampedY });
    } else if (draggingBtn === "right") {
      setRightBtnPos({ x: clampedX, y: clampedY });
    } else if (draggingBtn === "leftLock") {
      setLeftLockPos({ x: clampedX, y: clampedY });
    } else if (draggingBtn === "rightLock") {
      setRightLockPos({ x: clampedX, y: clampedY });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>, type: "left" | "right" | "leftLock" | "rightLock") => {
    const wasDragging = draggingBtn === type;
    setDraggingBtn(null);
    (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    if (!wasDragging) return;
  };

  useEffect(() => {
    const keyboardCleanup = keyboardEvents.setupKeyboardEvents();
    const videoCleanup = videoStream.setupVideoEventListeners();
    const mouseCleanup = mouseEvents.setupMouseEvents();

    return () => {
      keyboardCleanup?.();
      videoCleanup?.();
      mouseCleanup?.();
    };
  }, [keyboardEvents, videoStream, mouseEvents]);

  return (
    <div className=" h-full w-full flex flex-col justify-evenly overflow-hidden  bg-[#d3d3d3] dark:bg-[#1a1a1a]">
      <div></div>
      <StatsTobbar title={""} targetView={"SettingsModal"}> <SettingsModal /></StatsTobbar>
      <StatsTobbar title={"Clipboard"} targetView={"ClipboardMobile"}> <Clipboard /></StatsTobbar>

      <StatsTobbar title={""} targetView={"MacroMoreList"}> <MacroMoreList /></StatsTobbar>
      <EnhancedDrawer
        className={""}
        targetView={"TerminalTabsMobile"}
        placement={"top"}
        drawerRender={() => (<MobileTerminal/>)}
      />
      <EnhancedDrawer
        title={$at("PowerControl")}
        targetView={"PowerControl"}
        placement={"top"}
        drawerRender={() => (<PowerControl/>)}
      />

      <EnhancedDrawer
       title={macrosSideTitle}
       targetView={"Macros"}
       placement={"top"}
       drawerRender={() => (<SettingsMacros/>)}
      />

      <EnhancedDrawer
        targetView={"KeyboardPanel"}
        className={""}
        placement={"bottom"}
        drawerRender={() => (<KeyboardPanel/>)}
      />
      <EnhancedDrawer
        targetView={"MousePanel"}
        className={""}
        placement={"bottom"}
        drawerRender={() => (<MousePanel/>)}
      />
      <EnhancedDrawer
        targetView={"UsbEpModeSelect"}
        placement={"bottom"}
        drawerRender={() => (<UsbEpModeSelect/>)}
        className={"px-[20px]"}
      />

      <EnhancedDrawer
        title={$at("Virtual Media Source")}
        targetView={"VirtualMedia"}
        placement={"bottom"}
        drawerRender={() => (<VirtualMediaSource/>)}
      />
      <EnhancedDrawer
        title={$at("Video")}
        targetView={"SettingsVideo"}
        placement={"bottom"}
        drawerRender={() => (<SettingsVideoSide/>)}
      />
      <EnhancedDrawer
        title={$at("Connection Stats")}
        targetView={"connection-stats"}
        placement={"bottom"}
        drawerRender={() => (<ConnectionStatsSidebar/>)}
      />

      <audio
        id="global-audio"
        ref={audioElm}
        autoPlay
        muted={true}
        controls={false}
      />

      <VideoContainer containerRef={containerRef as React.RefObject<HTMLDivElement>}>
        <div className="flex h-full flex-col">
          <div className="relative grow h-full w-full overflow-hidden">
            <div className="flex h-full flex-col">
              <div className="grid grow grid-rows-(--grid-bodyFooter) overflow-hidden h-full w-full">
                <PointerLockBar show={overlays.showPointerLockBar} />

                <div
                  className={`relative h-full w-full  flex items-center justify-center overflow-hidden`}>
                  <div
                      ref={zoomContainerRef}
                      className={cx("relative flex h-full w-full items-center justify-center ", dark_bg_desktop)}
                      style={{
                          transform: `translate(${touchZoom.mobileTx}px, ${touchZoom.mobileTy}px) scale(${touchZoom.mobileScale})`,
                          transformOrigin: "center center",
                          touchAction: "none",
                      }}
                  >
                      <VideoElement
                        ref={videoElm}
                        onPlaying={videoStream.onVideoPlaying}
                        style={videoEffects.videoStyle}
                        className={cx(
                          `h-full  w-full  ${dark_bg_style_fun(isDark)} object-contain transition-all duration-1000`,
                          {
                            "cursor-none": videoEffects.settings.isCursorHidden,
                            "opacity-0": overlays.shouldHideVideo,
                            "opacity-60!": overlays.showPointerLockBar,
                            "animate-slideUpFade  dark:border-slate-300/20":
                            videoStream.isPlaying,
                          },
                        )}
                      />

                    {(videoStream.peerConnectionState === "connected" || forceHttp) && (
                      <div
                        style={{ animationDuration: "500ms" }}
                        className="animate-slideUpFade pointer-events-none absolute inset-0 flex items-center justify-center"
                      >
                        <div className="relative h-full w-full rounded-md">
                          <LoadingVideoOverlay show={overlays.showLoadingOverlay} />
                          <HDMIErrorOverlay show={overlays.showHDMIError} hdmiState={overlays.hdmiState} />

                          <NoAutoplayPermissionsOverlay
                            show={overlays.showNoAutoplayOverlay}
                            onPlayClick={videoStream.handlePlayClick}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  <div
                    className="pointer-events-none absolute inset-0"
                    onPointerMove={handlePointerMove}
                  >
                    <div
                      className={cx(
                        "pointer-events-auto absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-white text-xs",
                        isDark ? "bg-gray-500/70" : "bg-black/30",
                      )}
                      style={{
                        touchAction: "none",
                      }}
                      onClick={() => setShowVirtualMouseButtons(prev => !prev)}
                    >
                      <BsMouseFill className="h-4 w-4" />
                    </div>
                    {showVirtualMouseButtons && (
                      <>
                        <div
                          className={cx(
                            "pointer-events-auto absolute flex h-14 w-14 items-center justify-center rounded-full text-white text-xs active:scale-90 transition-transform duration-100",
                            isDark ? "bg-gray-500/70" : "bg-black/30",
                          )}
                          style={{
                            left: leftBtnPos.x,
                            top: leftBtnPos.y,
                            touchAction: "none",
                          }}
                          onPointerDown={e => {
                            handlePointerDown(e, "left");
                            updateButtons(1, true);
                          }}
                          onPointerUp={e => {
                            handlePointerUp(e, "left");
                            updateButtons(1, false);
                          }}
                        >
                          L
                        </div>

                        <div
                          className={cx(
                            "pointer-events-auto absolute flex h-14 w-14 items-center justify-center rounded-full text-white text-xs active:scale-90 transition-transform duration-100",
                            (lockedButtons & 1) ? "bg-green-600/80" : (isDark ? "bg-gray-500/70" : "bg-black/30"),
                          )}
                          style={{
                            left: leftLockPos.x,
                            top: leftLockPos.y,
                            touchAction: "none",
                          }}
                          onPointerDown={e => {
                            handlePointerDown(e, "leftLock");
                          }}
                          onPointerUp={e => {
                            handlePointerUp(e, "leftLock");
                          }}
                          onClick={() => toggleLock(1)}
                        >
                          {(lockedButtons & 1) ? <BsLockFill /> : <BsUnlockFill />} L
                        </div>

                        <div
                          className={cx(
                            "pointer-events-auto absolute flex h-14 w-14 items-center justify-center rounded-full text-white text-xs active:scale-90 transition-transform duration-100",
                            isDark ? "bg-gray-500/70" : "bg-black/30",
                          )}
                          style={{
                            left: rightBtnPos.x,
                            top: rightBtnPos.y,
                            touchAction: "none",
                          }}
                          onPointerDown={e => {
                            handlePointerDown(e, "right");
                            updateButtons(2, true);
                          }}
                          onPointerUp={e => {
                            handlePointerUp(e, "right");
                            updateButtons(2, false);
                          }}
                        >
                          R
                        </div>

                        <div
                          className={cx(
                            "pointer-events-auto absolute flex h-14 w-14 items-center justify-center rounded-full text-white text-xs active:scale-90 transition-transform duration-100",
                            (lockedButtons & 2) ? "bg-green-600/80" : (isDark ? "bg-gray-500/70" : "bg-black/30"),
                          )}
                          style={{
                            left: rightLockPos.x,
                            top: rightLockPos.y,
                            touchAction: "none",
                          }}
                          onPointerDown={e => {
                            handlePointerDown(e, "rightLock");
                          }}
                          onPointerUp={e => {
                            handlePointerUp(e, "rightLock");
                          }}
                          onClick={() => toggleLock(2)}
                        >
                          {(lockedButtons & 2) ? <BsLockFill /> : <BsUnlockFill />} R
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <VirtualKeyboard />
              </div>
            </div>
          </div>
        </div>
      </VideoContainer>

      <textarea
        ref={pasteCaptureRef}
        aria-hidden="true"
        tabIndex={-1}
        style={{ position: "fixed", left: -9999, top: -9999, width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
        onPaste={handleGlobalPaste}
      />
    </div>
  );
}
