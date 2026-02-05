import React from "react";

import SideTabs from "@components/Sidebar/SideTabs";
import DevicePage from "@/layout/components_side/VirtualMediaSource/DevicePage";
import SDPage from "@/layout/components_side/VirtualMediaSource/SDPage";
import UnMountPage from "@/layout/components_side/VirtualMediaSource/UnMount";


////* KVM MicroSD Mount */
// width: 143px;
// height: 11px;
// display: flex;
// flex-direction: row;
// align-items: center;
// 主组件
const VirtualMediaSource: React.FC = () => {

  return (
    <UnMountPage unmountedPage={(
      <SideTabs
        tab1Label="KVM Storage"
        tab2Label="MicroSD Card"
        tab1Content={<DevicePage />}
        tab2Content={<SDPage/>}
        defaultActiveKey="1"
      />
    )}/>

  );
};

export default VirtualMediaSource;
