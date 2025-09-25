import type { ReactNode } from 'react';
import React, { useState, type JSX } from 'react';

import CustomNav, { CustomNavTab, CustomNavDropdown } from './CustomNav';
import CustomTabContent from './CustomTabContent';

type CustomNavAndContentsProps = {
  navTabMapping: any,
  defaultTabIndex?: number,
  navigationMode?: 'both' | 'tab' | 'dropdown',
  tabContentClasses?: string[],
  breakpointToHideInactiveTabsDown?: 'xs' | 'sm' | 'md' | 'lg' | 'xl',
  navRightElement?: ReactNode
}


const CustomNavAndContents = (props: CustomNavAndContentsProps): JSX.Element => {
  const {
    navTabMapping, defaultTabIndex, navigationMode = 'tab', tabContentClasses = ['p-4'], breakpointToHideInactiveTabsDown, navRightElement,
  } = props;
  const [activeTab, setActiveTab] = useState(Object.keys(props.navTabMapping)[defaultTabIndex || 0]);

  let SelectedNav;
  switch (navigationMode) {
    case 'tab':
      SelectedNav = CustomNavTab;
      break;
    case 'dropdown':
      SelectedNav = CustomNavDropdown;
      break;
    case 'both':
      SelectedNav = CustomNav;
      break;
  }

  return (
    <>
      <SelectedNav
        activeTab={activeTab}
        navTabMapping={navTabMapping}
        onNavSelected={setActiveTab}
        breakpointToHideInactiveTabsDown={breakpointToHideInactiveTabsDown}
        navRightElement={navRightElement}
      />
      <CustomTabContent activeTab={activeTab} navTabMapping={navTabMapping} additionalClassNames={tabContentClasses} />
    </>
  );
};

export default CustomNavAndContents;
