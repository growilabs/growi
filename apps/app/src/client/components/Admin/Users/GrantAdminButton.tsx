import React, { type JSX, useCallback } from 'react';
import type { IUserHasId } from '@growi/core';
import { useTranslation } from 'next-i18next';

import AdminUsersContainer from '~/client/services/AdminUsersContainer';
import { toastError, toastSuccess } from '~/client/util/toastr';

import { withUnstatedContainers } from '../../UnstatedUtils';

type GrantAdminButtonExternalProps = {
  user: IUserHasId;
};

type GrantAdminButtonProps = GrantAdminButtonExternalProps & {
  adminUsersContainer: AdminUsersContainer;
};

const GrantAdminButton = (props: GrantAdminButtonProps): JSX.Element => {
  const { t } = useTranslation('admin');
  const { adminUsersContainer, user } = props;

  const onClickGrantAdminBtnHandler = useCallback(async () => {
    try {
      const username = await adminUsersContainer.grantUserAdmin(user._id);
      toastSuccess(t('toaster.grant_user_admin', { username }));
    } catch (err) {
      toastError(err);
    }
  }, [adminUsersContainer, t, user._id]);

  return (
    <button
      className="dropdown-item"
      type="button"
      onClick={() => onClickGrantAdminBtnHandler()}
    >
      <span className="material-symbols-outlined me-1">person_add</span>
      {t('user_management.user_table.grant_admin_access')}
    </button>
  );
};

/**
 * Wrapper component for using unstated
 */
const GrantAdminButtonWrapper = withUnstatedContainers<
  GrantAdminButtonExternalProps,
  GrantAdminButtonProps
>(GrantAdminButton, [AdminUsersContainer]);

export default GrantAdminButtonWrapper;
