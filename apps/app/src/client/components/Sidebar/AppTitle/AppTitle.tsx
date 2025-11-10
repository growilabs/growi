import React, { memo, type JSX } from 'react';

import Link from 'next/link';
import { UncontrolledTooltip } from 'reactstrap';

import { useAppTitle, useConfidential, useIsDefaultLogo } from '~/states/global';

import { SidebarBrandLogo } from '../SidebarBrandLogo';

import styles from './AppTitle.module.scss';


type Props = {
  className?: string,
  hideAppTitle?: boolean;
}

const AppTitleSubstance = memo(({ className = '', hideAppTitle = false }: Props): JSX.Element => {

  const isDefaultLogo = useIsDefaultLogo();
  const appTitle = useAppTitle();
  const confidential = useConfidential();

  return (
    <div className={`${styles['grw-app-title']} ${className} d-flex`}>
      {/* Brand Logo  */}
      <Link href="/" className="grw-logo d-block">
        <SidebarBrandLogo isDefaultLogo={isDefaultLogo} />
      </Link>
      <div className="flex-grow-1 d-flex align-items-center justify-content-between gap-3 overflow-hidden">
        {!hideAppTitle && (
          <div id="grw-site-name" className="grw-site-name text-truncate">
            <Link href="/" className="fs-4">
              {appTitle}
            </Link>
          </div>
        )}
      </div>
      {!(confidential == null || confidential === '')
      && (
        <UncontrolledTooltip
          className="d-none d-sm-block confidential-tooltip"
          innerClassName="text-start"
          data-testid="confidential-tooltip"
          placement="top"
          target="grw-site-name"
          fade={false}
        >
          {confidential}
        </UncontrolledTooltip>
      )}
    </div>
  );
});

export const AppTitleOnSubnavigation = memo((): JSX.Element => {
  return <AppTitleSubstance className={`position-absolute ${styles['on-subnavigation']}`} />;
});

export const AppTitleOnSidebarHead = memo(({ hideAppTitle }: Props): JSX.Element => {
  return (
    <AppTitleSubstance
      className={`position-absolute z-1 ${styles['on-sidebar-head']}`}
      hideAppTitle={hideAppTitle}
    />
  );
});

export const AppTitleOnEditorSidebarHead = memo((): JSX.Element => {
  return (
    <div className={`${styles['on-editor-sidebar-head']}`}>
      <AppTitleSubstance
        className={`${styles['on-sidebar-head']}`}
      />
    </div>
  );
});
