import React from "react";

import SideTabs from "@components/Sidebar/SideTabs";
import DeviceFilePage from "@/layout/components_side/SharedFolders/DeviceFilePage";
import SDFilePage from "@/layout/components_side/SharedFolders/SDFilePage";


const SharedFolders: React.FC = () => {

  return (
    <SideTabs
      tab1Label="KVM Storage"
      tab2Label="MicroSD Card"
      tab1Content={<DeviceFilePage />}
      tab2Content={<SDFilePage />}
      defaultActiveKey="1"
    />
  );
};

export default SharedFolders;
