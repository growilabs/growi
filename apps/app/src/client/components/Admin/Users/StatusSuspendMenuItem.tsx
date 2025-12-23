import React, { useCallback, type JSX } from 'react';

import type { IUserHasId } from '@growi/core';
import { useTranslation } from 'next-i18next';

import { withUnstatedContainers } from '~/client/components/UnstatedUtils';
import AdminUsersContainer from '~/client/services/AdminUsersContainer';
import { toastSuccess, toastError } from '~/client/util/toastr';
import { useCurrentUser } from '~/states/global';


const SuspendAlert = React.memo((): JSX.Element => {
  const { t } = useTranslation();

  return (
    <div className="px-4">
      <span className="material-symbols-outlined me-1 mb-2">cancel</span>{t('admin:user_management.user_table.deactivate_account')}
      <p className="alert alert-danger">{t('admin:user_management.user_table.your_own')}</p>
    </div>
  );
});

SuspendAlert.displayName = 'SuspendAlert';

type Props = {
  adminUsersContainer: AdminUsersContainer,
  user: IUserHasId,
}

const StatusSuspendMenuItem = (props: Props): JSX.Element => {
  const { t } = useTranslation('admin');

  const { adminUsersContainer, user } = props;

  const currentUser = useCurrentUser(); // custom hook now returns single value

  const clickDeactiveBtnHandler = useCallback(async() => {
    try {
      const username = await adminUsersContainer.deactivateUser(user._id);
      toastSuccess(t('toaster.deactivate_user_success', { username }));
    }
    catch (err) {
      toastError(err);
    }
  }, [adminUsersContainer, t, user._id]);

  return user.username !== currentUser?.username
    ? (
      <button className="dropdown-item" type="button" onClick={clickDeactiveBtnHandler}>
        <span className="material-symbols-outlined me-1">cancel</span> {t('user_management.user_table.deactivate_account')}
      </button>
    )
    : <SuspendAlert />;
};

/**
 * Wrapper component for using unstated
 */
// eslint-disable-next-line max-len
const StatusSuspendMenuItemWrapper: React.ForwardRefExoticComponent<Pick<any, string | number | symbol> & React.RefAttributes<any>> = withUnstatedContainers(StatusSuspendMenuItem, [AdminUsersContainer]);

export default StatusSuspendMenuItemWrapper;
