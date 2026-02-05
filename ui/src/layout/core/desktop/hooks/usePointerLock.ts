import { useCallback, useEffect, useState } from "react";

import { useSettingsStore } from "@/hooks/stores";

export const usePointerLock = (videoElm: React.RefObject<HTMLVideoElement>) => {
  const [isPointerLockActive, setIsPointerLockActive] = useState(false);
  const settings = useSettingsStore();
  const isPointerLockPossible = window.location.protocol === "https:" || window.location.hostname === "localhost";

  const checkNavigatorPermissions = useCallback(async (permissionName: string) => {
    if (!navigator.permissions?.query) return false;

    try {
      const { state } = await navigator.permissions.query({
        name: permissionName as PermissionName
      });
      return state === "granted";
    } catch {
      return false;
    }
  }, []);

  const requestPointerLock = useCallback(async () => {
    if (!isPointerLockPossible || !videoElm.current || document.pointerLockElement) return;

    const isPointerLockGranted = await checkNavigatorPermissions("pointer-lock");
    if (isPointerLockGranted && settings.mouseMode === "relative") {
      try {
        await videoElm.current.requestPointerLock();
      } catch {
        // ignore errors
      }
    }
  }, [checkNavigatorPermissions, isPointerLockPossible, settings.mouseMode, videoElm]);

  useEffect(() => {
    if (!isPointerLockPossible || !videoElm.current) return;

    const handlePointerLockChange = () => {
      setIsPointerLockActive(!!document.pointerLockElement);
    };

    document.addEventListener("pointerlockchange", handlePointerLockChange);
    return () => document.removeEventListener("pointerlockchange", handlePointerLockChange);
  }, [isPointerLockPossible, videoElm]);

  return {
    isPointerLockActive,
    isPointerLockPossible,
    requestPointerLock,
  };
};