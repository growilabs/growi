import React, { FC, memo, useMemo } from 'react';

import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { UncontrolledTooltip } from 'reactstrap';

import AppContainer from '~/client/services/AppContainer';
import { IUser } from '~/interfaces/user';
import { useIsSearchPage, useCurrentPagePath } from '~/stores/context';
import { usePageCreateModal } from '~/stores/modal';
import { useIsDeviceSmallerThanMd } from '~/stores/ui';

import GrowiLogo from '../Icons/GrowiLogo';
import InAppNotificationDropdown from '../InAppNotification/InAppNotificationDropdown';
import { withUnstatedContainers } from '../UnstatedUtils';

import { AppearanceModeDropdown } from './AppearanceModeDropdown';
import GlobalSearch from './GlobalSearch';
import PersonalDropdown from './PersonalDropdown';


type NavbarRightProps = {
  currentUser: IUser,
}
const NavbarRight: FC<NavbarRightProps> = memo((props: NavbarRightProps) => {
  const { t } = useTranslation();
  const { data: currentPagePath } = useCurrentPagePath();
  const { open: openCreateModal } = usePageCreateModal();

  const { currentUser } = props;
  const isAuthenticated = currentUser != null;

  const authenticatedNavItem = useMemo(() => {
    return (
      <>
        <li className="nav-item">
          <InAppNotificationDropdown />
        </li>

        <li className="nav-item d-none d-md-block">
          <button
            className="px-md-3 nav-link btn-create-page border-0 bg-transparent"
            type="button"
            data-testid="newPageBtn"
            onClick={() => openCreateModal(currentPagePath || '')}
          >
            <i className="icon-pencil mr-2"></i>
            <span className="d-none d-lg-block">{ t('New') }</span>
          </button>
        </li>

        <li className="grw-personal-dropdown nav-item dropdown">
          <AppearanceModeDropdown isAuthenticated={isAuthenticated} />
        </li>

        <li className="grw-personal-dropdown nav-item dropdown dropdown-toggle dropdown-toggle-no-caret" data-testid="grw-personal-dropdown">
          <PersonalDropdown />
        </li>
      </>
    );
  }, [t, currentPagePath, openCreateModal, isAuthenticated]);

  const notAuthenticatedNavItem = useMemo(() => {
    return (
      <>
        <li className="grw-personal-dropdown nav-item dropdown">
          <AppearanceModeDropdown isAuthenticated={isAuthenticated} />
        </li>

        <li id="login-user" className="nav-item"><a className="nav-link" href="/login">Login</a></li>;
      </>
    );
  }, []);

  return (
    <>
      {isAuthenticated ? authenticatedNavItem : notAuthenticatedNavItem}
    </>
  );
});

type ConfidentialProps = {
  confidential?: string,
}
const Confidential: FC<ConfidentialProps> = memo((props: ConfidentialProps) => {
  const { confidential } = props;

  if (confidential == null) {
    return null;
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


const GrowiNavbar = (props) => {

  const { appContainer } = props;
  const { currentUser } = appContainer;
  const { crowi, isSearchServiceConfigured } = appContainer.config;

  const { data: isDeviceSmallerThanMd } = useIsDeviceSmallerThanMd();
  const { data: isSearchPage } = useIsSearchPage();

  return (
    <>
      {/* Brand Logo  */}
      <div className="navbar-brand mr-0">
        <a className="grw-logo d-block" href="/">
          <GrowiLogo />
        </a>
      </div>

      <div className="grw-app-title d-none d-md-block">
        {crowi.title}
      </div>


      {/* Navbar Right  */}
      <ul className="navbar-nav ml-auto">
        <NavbarRight currentUser={currentUser}></NavbarRight>
        <Confidential confidential={crowi.confidential}></Confidential>
      </ul>

      { isSearchServiceConfigured && !isDeviceSmallerThanMd && !isSearchPage && (
        <div className="grw-global-search grw-global-search-top position-absolute">
          <GlobalSearch />
        </div>
      ) }
    </>
  );

};

/**
 * Wrapper component for using unstated
 */
const GrowiNavbarWrapper = withUnstatedContainers(GrowiNavbar, [AppContainer]);


GrowiNavbar.propTypes = {
  appContainer: PropTypes.instanceOf(AppContainer).isRequired,
};

export default GrowiNavbarWrapper;
