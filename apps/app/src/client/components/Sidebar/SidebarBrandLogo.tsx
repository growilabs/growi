import { memo } from 'react';

import GrowiLogo from '../../../components/Common/GrowiLogo';

type SidebarBrandLogoProps = {
  isDefaultLogo?: boolean
}

export const SidebarBrandLogo = memo((props: SidebarBrandLogoProps) => {
  const { isDefaultLogo } = props;

  return isDefaultLogo
    ? <GrowiLogo />
    // eslint-disable-next-line @next/next/no-img-element
    : (<div><img src="/attachment/brand-logo" alt="custom logo" className="picture picture-lg p-2" id="settingBrandLogo" /></div>);
});

SidebarBrandLogo.displayName = 'SidebarBrandLogo';
