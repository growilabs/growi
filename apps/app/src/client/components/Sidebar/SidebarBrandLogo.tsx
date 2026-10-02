import { memo } from 'react';

import GrowiLogo from '../../../components/Common/GrowiLogo';

type SidebarBrandLogoProps = {
  isDefaultLogo?: boolean;
};

export const SidebarBrandLogo = memo((props: SidebarBrandLogoProps) => {
  const { isDefaultLogo } = props;

  return isDefaultLogo ? (
    <GrowiLogo />
  ) : (
    <div>
      <img
        src="/attachment/brand-logo"
        alt="custom logo"
        width="48"
        className="p-1"
        id="settingBrandLogo"
      />
    </div>
  );
});

SidebarBrandLogo.displayName = 'SidebarBrandLogo';
