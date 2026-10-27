import type { JSX } from 'react';
import { format as dateFnsFormat } from 'date-fns/format';
import { useTranslation } from 'next-i18next';

import InfiniteScroll from '~/client/components/InfiniteScroll';
import type { PasswordHashUnmigratedUser } from '~/interfaces/password-hash-status';
import {
  isLastUnmigratedUsersPage,
  useSWRInfinitePasswordHashUnmigratedUsers,
} from '~/stores/admin/password-hash-unmigrated-users';

import { ErrorWithRetry } from './ErrorWithRetry';

const I18N_PREFIX = 'security_settings.legacy_password_cleanup.unmigrated_list';

// The list sits above other settings, so it loads more inside its own
// fixed-height box instead of growing with the page scroll.
const SCROLL_BOX_MAX_HEIGHT = '400px';

type UserTableProps = {
  users: PasswordHashUnmigratedUser[];
};

const UserTable = ({ users }: UserTableProps): JSX.Element => {
  const { t } = useTranslation('admin');
  return (
    <table className="table table-bordered table-sm w-auto mb-0">
      <thead>
        <tr>
          <th>{t(`${I18N_PREFIX}.column.username`)}</th>
          <th>{t(`${I18N_PREFIX}.column.email`)}</th>
          <th>{t(`${I18N_PREFIX}.column.last_login`)}</th>
        </tr>
      </thead>
      <tbody>
        {users.map((user) => (
          <tr key={user._id}>
            <td>{user.username}</td>
            <td>{user.email ?? '-'}</td>
            <td>
              {user.lastLoginAt != null
                ? dateFnsFormat(new Date(user.lastLoginAt), 'yyyy-MM-dd HH:mm')
                : t(`${I18N_PREFIX}.never_logged_in`)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export const UnmigratedUserList = (): JSX.Element => {
  const { t } = useTranslation('admin');
  const swrInfiniteResponse = useSWRInfinitePasswordHashUnmigratedUsers();
  const { data, error, size, setSize, isValidating } = swrInfiniteResponse;

  // The failed page is the last one of the current size and has no cached
  // data, so re-setting the same size fetches it again — page 1 included.
  const retry = () => {
    setSize(size);
  };

  const renderBody = (): JSX.Element | null => {
    const totalCount = data?.[0]?.totalCount;
    // Only a failure before any page arrived replaces the list; a later
    // page's failure keeps the rows already shown.
    if (error != null && totalCount == null) {
      return (
        <ErrorWithRetry
          message={t(`${I18N_PREFIX}.fetch_error`)}
          isRetrying={isValidating}
          onRetry={retry}
        />
      );
    }
    if (data == null || totalCount == null) {
      return null;
    }
    if (totalCount === 0) {
      return <p className="text-muted">{t(`${I18N_PREFIX}.empty`)}</p>;
    }
    const users = data.flatMap((page) => page.users);
    const lastPage = data[data.length - 1];
    const isReachingEnd =
      lastPage != null && isLastUnmigratedUsersPage(lastPage);
    return (
      <div
        className="mb-3"
        style={{ maxHeight: SCROLL_BOX_MAX_HEIGHT, overflowY: 'auto' }}
      >
        {error != null ? (
          // InfiniteScroll is left out while in error: its loader would keep
          // growing the size and re-requesting the failed page on its own.
          <>
            <UserTable users={users} />
            <ErrorWithRetry
              message={t(`${I18N_PREFIX}.load_more_error`)}
              isRetrying={isValidating}
              onRetry={retry}
            />
          </>
        ) : (
          <InfiniteScroll
            swrInifiniteResponse={swrInfiniteResponse}
            isReachingEnd={isReachingEnd}
          >
            <UserTable users={users} />
          </InfiniteScroll>
        )}
      </div>
    );
  };

  return (
    <div className="mt-4">
      <h3 className="h5">{t(`${I18N_PREFIX}.title`)}</h3>
      <p className="mb-3">{t(`${I18N_PREFIX}.description`)}</p>
      {renderBody()}
    </div>
  );
};
