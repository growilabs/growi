import React, {
  FC, memo, useMemo, useRef,
} from 'react';

import { isServer } from '@growi/core';
import { useTranslation } from 'next-i18next';
import dynamic from 'next/dynamic';
import { useRipple } from 'react-use-ripple';
import { UncontrolledTooltip } from 'reactstrap';

import { HasChildren } from '~/interfaces/common';
import {
  useIsSearchPage, useCurrentPagePath, useIsGuestUser, useIsSearchServiceConfigured, useAppTitle, useConfidential,
} from '~/stores/context';
import { usePageCreateModal } from '~/stores/modal';
import { useIsDeviceSmallerThanMd } from '~/stores/ui';

import GrowiLogo from '../Icons/GrowiLogo';

import PersonalDropdown from './PersonalDropdown';

import styles from './GrowiNavbar.module.scss';


const ShowSkeltonInSSR = memo(({ children }: HasChildren): JSX.Element => {
  return isServer()
    ? <></>
    : <>{children}</>;
});
ShowSkeltonInSSR.displayName = 'ShowSkeltonInSSR';

const NavbarRight = memo((): JSX.Element => {
  const { t } = useTranslation();

  const InAppNotificationDropdown = dynamic(() => import('../InAppNotification/InAppNotificationDropdown')
    .then(mod => mod.InAppNotificationDropdown), { ssr: false });
  const AppearanceModeDropdown = dynamic(() => import('./AppearanceModeDropdown').then(mod => mod.AppearanceModeDropdown), { ssr: false });

  const { data: currentPagePath } = useCurrentPagePath();
  const { data: isGuestUser } = useIsGuestUser();

  // ripple
  const newButtonRef = useRef(null);
  useRipple(newButtonRef, { rippleColor: 'rgba(255, 255, 255, 0.3)' });

  const { open: openCreateModal } = usePageCreateModal();

  const isAuthenticated = isGuestUser === false;

  const authenticatedNavItem = useMemo(() => {
    return (
      <>
        <li className="nav-item">
          <ShowSkeltonInSSR><InAppNotificationDropdown /></ShowSkeltonInSSR>
        </li>

        <li className="nav-item d-none d-md-block">
          <button
            className="px-md-3 nav-link btn-create-page border-0 bg-transparent"
            type="button"
            ref={newButtonRef}
            data-testid="newPageBtn"
            onClick={() => openCreateModal(currentPagePath || '')}
          >
            <i className="icon-pencil mr-2"></i>
            <span className="d-none d-lg-block">{ t('New') }</span>
          </button>
        </li>

        <li className="grw-apperance-mode-dropdown nav-item dropdown">
          <ShowSkeltonInSSR><AppearanceModeDropdown isAuthenticated={isAuthenticated} /></ShowSkeltonInSSR>
        </li>

        <li className="grw-personal-dropdown nav-item dropdown dropdown-toggle dropdown-toggle-no-caret" data-testid="grw-personal-dropdown">
          <ShowSkeltonInSSR><PersonalDropdown /></ShowSkeltonInSSR>
        </li>
      </>
    );
  }, [InAppNotificationDropdown, t, AppearanceModeDropdown, isAuthenticated, openCreateModal, currentPagePath]);

  const notAuthenticatedNavItem = useMemo(() => {
    return (
      <>
        <li className="grw-apperance-mode-dropdown nav-item dropdown">
          <ShowSkeltonInSSR><AppearanceModeDropdown isAuthenticated={isAuthenticated} /></ShowSkeltonInSSR>
        </li>

        <li id="login-user" className="nav-item"><a className="nav-link" href="/login">Login</a></li>;
      </>
    );
  }, [AppearanceModeDropdown, isAuthenticated]);

  return (
    <>
      {isAuthenticated ? authenticatedNavItem : notAuthenticatedNavItem}
    </>
  );
});
NavbarRight.displayName = 'NavbarRight';

type ConfidentialProps = {
  confidential?: string,
}
const Confidential: FC<ConfidentialProps> = memo((props: ConfidentialProps): JSX.Element => {
  const { confidential } = props;

  if (confidential == null || confidential.length === 0) {
    return <></>;
  }

  return (
    <li className="nav-item confidential text-light">
      <i id="confidentialTooltip" className="icon-info d-md-none" />
      <span className="d-none d-md-inline">
        {confidential}
      </span>
      <UncontrolledTooltip
        placement="bottom"
        target="confidentialTooltip"
        className="d-md-none"
      >
        {confidential}
      </UncontrolledTooltip>
    </li>
  );
});
Confidential.displayName = 'Confidential';


export const GrowiNavbar = (): JSX.Element => {

  const GlobalSearch = dynamic(() => import('./GlobalSearch').then(mod => mod.GlobalSearch), { ssr: false });

  const { data: appTitle } = useAppTitle();
  const { data: confidential } = useConfidential();
  const { data: isSearchServiceConfigured } = useIsSearchServiceConfigured();
  const { data: isDeviceSmallerThanMd } = useIsDeviceSmallerThanMd();
  const { data: isSearchPage } = useIsSearchPage();

  return (
    <nav id="grw-navbar" className={`navbar grw-navbar ${styles['grw-navbar']} navbar-expand navbar-dark sticky-top mb-0 px-0`}>
      {/* Brand Logo  */}
      <div className="navbar-brand mr-0">
        <a className="grw-logo d-block" href="/">
          <GrowiLogo />
        </a>
      </div>

      <div className="grw-app-title d-none d-md-block">
        {appTitle}
      </div>


      {/* Navbar Right  */}
      <ul className="navbar-nav ml-auto">
        <NavbarRight />
        <Confidential confidential={confidential} />
      </ul>

      { isSearchServiceConfigured && !isDeviceSmallerThanMd && !isSearchPage && (
        <div className="grw-global-search-container position-absolute">
          <GlobalSearch />
        </div>
      ) }
    </nav>
  );

};
