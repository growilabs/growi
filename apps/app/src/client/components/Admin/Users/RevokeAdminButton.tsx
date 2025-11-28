import React, { useCallback, type JSX } from 'react';

import type { IUserHasId } from '@growi/core';
import { useTranslation } from 'next-i18next';

import AdminUsersContainer from '~/client/services/AdminUsersContainer';
import { toastSuccess, toastError } from '~/client/util/toastr';
import { useCurrentUser } from '~/states/global';

import { withUnstatedContainers } from '../../UnstatedUtils';

type RevokeAdminButtonProps = {
  adminUsersContainer: AdminUsersContainer,
  user: IUserHasId,
}

const RevokeAdminButton = (props: RevokeAdminButtonProps): JSX.Element => {

  const { t } = useTranslation('admin');
  const currentUser = useCurrentUser(); // hook returns single value now
  const { adminUsersContainer, user } = props;

  const onClickRevokeAdminBtnHandler = useCallback(async() => {
    try {
      const username = await adminUsersContainer.revokeUserAdmin(user._id);
      toastSuccess(t('toaster.revoke_user_admin', { username }));
    }
    catch (err) {
      toastError(err);
    }
  }, [adminUsersContainer, t, user._id]);

  const renderRevokeAdminBtn = () => {
    return (
      <button className="dropdown-item" type="button" onClick={() => onClickRevokeAdminBtnHandler()}>
        <span className="material-symbols-outlined me-1">person_remove</span>{t('user_management.user_table.revoke_admin_access')}
      </button>
    );
  };

  const renderRevokeAdminAlert = () => {
    return (
      <div className="px-4">
        <span className="material-symbols-outlined me-1 mb-2">person_remove</span>{t('user_management.user_table.revoke_admin_access')}
        <p className="alert alert-danger">{t('user_management.user_table.cannot_revoke')}</p>
      </div>
    );
  };

  if (currentUser == null) {
    return <></>;
  }

  return (
    <>
      {user.username !== currentUser.username ? renderRevokeAdminBtn()
        : renderRevokeAdminAlert()}
    </>
  );
};

/**
* Wrapper component for using unstated
*/
const RevokeAdminButtonWrapper = withUnstatedContainers(RevokeAdminButton, [AdminUsersContainer]);

export default RevokeAdminButtonWrapper;
