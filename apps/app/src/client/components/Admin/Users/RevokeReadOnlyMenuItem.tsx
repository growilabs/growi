import React, { useCallback, type JSX } from 'react';

import type { IUserHasId } from '@growi/core';
import { useTranslation } from 'next-i18next';

import AdminUsersContainer from '~/client/services/AdminUsersContainer';
import { toastSuccess, toastError } from '~/client/util/toastr';

import { withUnstatedContainers } from '../../UnstatedUtils';

const RevokeReadOnlyMenuItem: React.FC<{
  adminUsersContainer: AdminUsersContainer,
  user: IUserHasId,
}> = ({ adminUsersContainer, user }): JSX.Element => {
  const { t } = useTranslation('admin');

  const clickRevokeReadOnlyBtnHandler = useCallback(async() => {
    try {
      const username = await adminUsersContainer.revokeUserReadOnly(user._id);
      toastSuccess(t('toaster.revoke_user_read_only', { username }));
    }
    catch (err) {
      toastError(err);
    }
  }, [adminUsersContainer, t, user._id]);

  return (
    <button className="dropdown-item" type="button" onClick={clickRevokeReadOnlyBtnHandler}>
      <span className="material-symbols-outlined me-1">person_remove</span> {t('user_management.user_table.revoke_read_only_access')}
    </button>
  );
};

/**
* Wrapper component for using unstated
*/
// eslint-disable-next-line max-len
const RevokeReadOnlyMenuItemWrapper: React.ForwardRefExoticComponent<Pick<any, string | number | symbol> & React.RefAttributes<any>> = withUnstatedContainers(RevokeReadOnlyMenuItem, [AdminUsersContainer]);

export default RevokeReadOnlyMenuItemWrapper;
