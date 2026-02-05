import { useState } from "react";

import { FileManager } from "@/layout/components_side/SharedFolders/FileManager";
import notifications from "@/notifications";
import { useJsonRpc } from "@/hooks/useJsonRpc";

export default function SDFilePage() {
  const [send] = useJsonRpc();
  const [loading, setLoading] = useState(false);

  const handleResetSDStorage = async () => {
    setLoading(true);
    send("resetSDStorage", {}, res => {
      if ("error" in res) {
        notifications.error(`Failed to reset SD card`);
        setLoading(false);
        return;
      }
    });
    await new Promise(resolve => setTimeout(resolve, 2000));
    setLoading(false);
  };

  const handleUnmountSDStorage = async () => {
    setLoading(true);
    send("unmountSDStorage", {}, res => {
      if ("error" in res) {
        notifications.error(`Failed to unmount SD card`);
        setLoading(false);
        return;
      }
    });
    await new Promise(resolve => setTimeout(resolve, 2000));
    setLoading(false);
  };

  return (
    <FileManager
      mediaType="sd"
      returnTo="/sd-files"
      listFilesMethod="listSDStorageFiles"
      getSpaceMethod="getSDStorageSpace"
      deleteFileMethod="deleteSDStorageFile"
      downloadUrlPrefix="/storage/sd-download"
      showSDManagement={true}
      onResetSDStorage={handleResetSDStorage}
      onUnmountSDStorage={handleUnmountSDStorage}
    />
  );
}