import React, { memo, useMemo } from 'react';

import type { SidebarContentsType } from '~/interfaces/ui';
import { useIsGuestUser, useIsReadOnlyUser } from '~/states/context';

import { NotAvailableForReadOnlyUser } from '../../NotAvailableForReadOnlyUser';
import { PageCreateButton } from '../PageCreateButton';

import { PrimaryItems } from './PrimaryItems';
import { SecondaryItems } from './SecondaryItems';

import styles from './SidebarNav.module.scss';

export type SidebarNavProps = {
  onPrimaryItemHover?: (contents: SidebarContentsType) => void,
}

export const SidebarNav = memo((props: SidebarNavProps) => {
  const { onPrimaryItemHover } = props;

  const isGuestUser = useIsGuestUser();
  const isReadOnlyUser = useIsReadOnlyUser();

  const renderedPageCreateButton = useMemo(() => {
    if (isGuestUser) {
      return <></>;
    }

    if (isReadOnlyUser) {
      return (
        <NotAvailableForReadOnlyUser>
          <PageCreateButton />
        </NotAvailableForReadOnlyUser>
      );
    }

    return <PageCreateButton />;
  }, [isGuestUser, isReadOnlyUser]);

  return (
    <div className={`grw-sidebar-nav ${styles['grw-sidebar-nav']}`}>

      {renderedPageCreateButton}

      <div className="grw-sidebar-nav-primary-container" data-vrt-blackout-sidebar-nav>
        <PrimaryItems onItemHover={onPrimaryItemHover} />
      </div>

      <div className="grw-sidebar-nav-secondary-container">
        <SecondaryItems />
      </div>
    </div>
  );
});
