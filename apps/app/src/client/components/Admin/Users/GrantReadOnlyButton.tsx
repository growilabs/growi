import React, { useCallback, type JSX } from 'react';

import type { IUserHasId } from '@growi/core';
import { useTranslation } from 'next-i18next';

import AdminUsersContainer from '~/client/services/AdminUsersContainer';
import { toastSuccess, toastError } from '~/client/util/toastr';

import { withUnstatedContainers } from '../../UnstatedUtils';

const GrantReadOnlyButton: React.FC<{
  adminUsersContainer: AdminUsersContainer,
  user: IUserHasId,
}> = ({ adminUsersContainer, user }): JSX.Element => {
  const { t } = useTranslation('admin');

  const onClickGrantReadOnlyBtnHandler = useCallback(async() => {
    try {
      const username = await adminUsersContainer.grantUserReadOnly(user._id);
      toastSuccess(t('toaster.grant_user_read_only', { username }));
    }
    catch (err) {
      toastError(err);
    }
  }, [adminUsersContainer, t, user._id]);

  return (
    <button className="dropdown-item" type="button" onClick={onClickGrantReadOnlyBtnHandler}>
      <span className="material-symbols-outlined me-1">person_add</span>{t('user_management.user_table.grant_read_only_access')}
    </button>
  );
};

/**
 * Wrapper component for using unstated
 */
// eslint-disable-next-line max-len
const GrantReadOnlyButtonWrapper: React.ForwardRefExoticComponent<Pick<any, string | number | symbol> & React.RefAttributes<any>> = withUnstatedContainers(GrantReadOnlyButton, [AdminUsersContainer]);

export default GrantReadOnlyButtonWrapper;
