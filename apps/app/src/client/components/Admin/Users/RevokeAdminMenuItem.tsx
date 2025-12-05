import React, { useCallback, type JSX } from 'react';

import type { IUserHasId } from '@growi/core';
import { useTranslation } from 'next-i18next';

import AdminUsersContainer from '~/client/services/AdminUsersContainer';
import { toastSuccess, toastError } from '~/client/util/toastr';
import { useCurrentUser } from '~/states/global';

import { withUnstatedContainers } from '../../UnstatedUtils';


const RevokeAdminAlert = React.memo((): JSX.Element => {
  const { t } = useTranslation();

  return (
    <div className="px-4">
      <span className="material-symbols-outlined me-1 mb-2">person_remove</span>{t('admin:user_management.user_table.revoke_admin_access')}
      <p className="alert alert-danger">{t('admin:user_management.user_table.cannot_revoke')}</p>
    </div>
  );
});
RevokeAdminAlert.displayName = 'RevokeAdminAlert';


type Props = {
  adminUsersContainer: AdminUsersContainer,
  user: IUserHasId,
}

const RevokeAdminMenuItem = (props: Props): JSX.Element => {
  const { t } = useTranslation('admin');

  const { adminUsersContainer, user } = props;

  const currentUser = useCurrentUser();

  const clickRevokeAdminBtnHandler = useCallback(async() => {
    try {
      const username = await adminUsersContainer.revokeUserAdmin(user._id);
      toastSuccess(t('toaster.revoke_user_admin', { username }));
    }
    catch (err) {
      toastError(err);
    }
  }, [adminUsersContainer, t, user._id]);


  return user.username !== currentUser?.username
    ? (
      <button className="dropdown-item" type="button" onClick={clickRevokeAdminBtnHandler}>
        <span className="material-symbols-outlined me-1">person_remove</span> {t('user_management.user_table.revoke_admin_access')}
      </button>
    )
    : <RevokeAdminAlert />;
};

/**
* Wrapper component for using unstated
*/
// eslint-disable-next-line max-len
const RevokeAdminMenuItemWrapper: React.ForwardRefExoticComponent<Pick<any, string | number | symbol> & React.RefAttributes<any>> = withUnstatedContainers(RevokeAdminMenuItem, [AdminUsersContainer]);

export default RevokeAdminMenuItemWrapper;
