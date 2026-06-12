import React, { type FC, memo } from 'react';

import { ToggleCollapseButton } from './ToggleCollapseButton';

import styles from './SidebarHead.module.scss';

export const SidebarHead: FC = memo(() => {
  return (
    <div
      className={`${styles['grw-sidebar-head']} d-flex justify-content-end w-100`}
    >
      <ToggleCollapseButton />
    </div>
  );
});
