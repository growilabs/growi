import React, { useCallback, type JSX } from 'react';

import type { IUserHasId } from '@growi/core';
import { useTranslation } from 'next-i18next';

import AdminUsersContainer from '~/client/services/AdminUsersContainer';
import { toastSuccess, toastError } from '~/client/util/toastr';

import { withUnstatedContainers } from '../../UnstatedUtils';

type GrantAdminButtonProps = {
  adminUsersContainer: AdminUsersContainer,
  user: IUserHasId,
}

const GrantAdminButton = (props: GrantAdminButtonProps): JSX.Element => {

  const { t } = useTranslation('admin');
  const { adminUsersContainer, user } = props;

  const onClickGrantAdminBtnHandler = useCallback(async() => {
    try {
      const username = await adminUsersContainer.grantUserAdmin(user._id);
      toastSuccess(t('toaster.grant_user_admin', { username }));
    }
    catch (err) {
      toastError(err);
    }
  }, [adminUsersContainer, t, user._id]);

  return (
    <button className="dropdown-item" type="button" onClick={() => onClickGrantAdminBtnHandler()}>
      <span className="material-symbols-outlined me-1">person_add</span>{t('user_management.user_table.grant_admin_access')}
    </button>
  );

};

/**
 * Wrapper component for using unstated
 */
// eslint-disable-next-line max-len
const GrantAdminButtonWrapper: React.ForwardRefExoticComponent<Pick<any, string | number | symbol> & React.RefAttributes<any>> = withUnstatedContainers(GrantAdminButton, [AdminUsersContainer]);

export default GrantAdminButtonWrapper;
