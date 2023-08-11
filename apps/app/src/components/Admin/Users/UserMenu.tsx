import React, { useState, useCallback } from 'react';

import { type IUserHasId, USER_STATUS } from '@growi/core';
import { useTranslation } from 'next-i18next';
import {
  UncontrolledDropdown, DropdownToggle, DropdownMenu,
} from 'reactstrap';

import AdminUsersContainer from '~/client/services/AdminUsersContainer';

import { withUnstatedContainers } from '../../UnstatedUtils';

import GrantAdminButton from './GrantAdminButton';
import GrantReadOnlyButton from './GrantReadOnlyButton';
import RevokeAdminMenuItem from './RevokeAdminMenuItem';
import RevokeReadOnlyMenuItem from './RevokeReadOnlyMenuItem';
import SendInvitationEmailButton from './SendInvitationEmailButton';
import StatusActivateButton from './StatusActivateButton';
import StatusSuspendedMenuItem from './StatusSuspendMenuItem';
import UserRemoveButton from './UserRemoveButton';

import styles from './UserMenu.module.scss';

type UserMenuProps = {
  adminUsersContainer: AdminUsersContainer,
  user: IUserHasId,
}

const UserMenu = (props: UserMenuProps) => {
  const { t } = useTranslation('admin');

  const { adminUsersContainer, user } = props;

  const [isInvitationEmailSended, setIsInvitationEmailSended] = useState<boolean>(user.isInvitationEmailSended);

  const onClickPasswordResetHandler = useCallback(async() => {
    await adminUsersContainer.showPasswordResetModal(user);
  }, [adminUsersContainer, user]);

  const onSuccessfullySentInvitationEmailHandler = useCallback(() => {
    setIsInvitationEmailSended(true);
  }, []);

  const renderEditMenu = useCallback(() => {
    return (
      <>
        <li className="dropdown-divider"></li>
        <li className="dropdown-header">{t('user_management.user_table.edit_menu')}</li>
        <li>
          <button className="dropdown-item" type="button" onClick={onClickPasswordResetHandler}>
            <i className="icon-fw icon-key"></i>{ t('user_management.reset_password') }
          </button>
        </li>
      </>
    );
  }, [onClickPasswordResetHandler, t]);

  const renderStatusMenu = useCallback(() => {
    return (
      <>
        <li className="dropdown-divider"></li>
        <li className="dropdown-header">{t('user_management.status')}</li>
        <li>
          {(user.status === USER_STATUS.REGISTERED || user.status === USER_STATUS.SUSPENDED) && <StatusActivateButton user={user} />}
          {user.status === USER_STATUS.ACTIVE && <StatusSuspendedMenuItem user={user} />}
          {user.status === USER_STATUS.INVITED && (
            <SendInvitationEmailButton
              user={user}
              isInvitationEmailSended={isInvitationEmailSended}
              onSuccessfullySentInvitationEmail={onSuccessfullySentInvitationEmailHandler}
            />
          )}
          {(user.status === USER_STATUS.REGISTERED || user.status === USER_STATUS.SUSPENDED || user.status === USER_STATUS.INVITED)
          && <UserRemoveButton user={user} />}
        </li>
      </>
    );
  }, [isInvitationEmailSended, onSuccessfullySentInvitationEmailHandler, t, user]);

  const renderAdminMenu = useCallback(() => {
    return (
      <>
        <li className="dropdown-divider pl-0"></li>
        <li className="dropdown-header">{t('user_management.user_table.administrator_menu')}</li>
        <li>
          {user.admin ? <RevokeAdminMenuItem user={user} /> : <GrantAdminButton user={user} />}
        </li>
        <li>
          {user.readOnly ? <RevokeReadOnlyMenuItem user={user} /> : <GrantReadOnlyButton user={user} />}
        </li>
      </>
    );
  }, [t, user]);

  return (
    <UncontrolledDropdown id="userMenu" size="sm">
      <DropdownToggle caret color="secondary" outline>
        <i className="icon-settings" />
        {(user.status === USER_STATUS.INVITED && !isInvitationEmailSended)
        && <i className={`fa fa-circle text-danger grw-usermenu-notification-icon ${styles['grw-usermenu-notification-icon']}`} />}
      </DropdownToggle>
      <DropdownMenu>
        {renderEditMenu()}
        {user.status !== USER_STATUS.DELETED && renderStatusMenu()}
        {user.status === USER_STATUS.ACTIVE && renderAdminMenu()}
      </DropdownMenu>
    </UncontrolledDropdown>
  );

};

/**
* Wrapper component for using unstated
*/
// eslint-disable-next-line max-len
const UserMenuWrapper: React.ForwardRefExoticComponent<Pick<any, string | number | symbol> & React.RefAttributes<any>> = withUnstatedContainers(UserMenu, [AdminUsersContainer]);

export default UserMenuWrapper;
