import type { JSX } from 'react';
import { format as dateFnsFormat } from 'date-fns/format';
import { useTranslation } from 'next-i18next';

import InfiniteScroll from '~/client/components/InfiniteScroll';
import {
  isLastUnmigratedUsersPage,
  useSWRInfinitePasswordHashUnmigratedUsers,
} from '~/stores/admin/password-hash-unmigrated-users';

const I18N_PREFIX = 'security_settings.legacy_password_cleanup.unmigrated_list';

// The list sits above other settings, so it loads more inside its own
// fixed-height box instead of growing with the page scroll.
const SCROLL_BOX_MAX_HEIGHT = '400px';

export const UnmigratedUserList = (): JSX.Element => {
  const { t } = useTranslation('admin');
  const swrInfiniteResponse = useSWRInfinitePasswordHashUnmigratedUsers();
  const { data, error } = swrInfiniteResponse;

  const renderBody = (): JSX.Element | null => {
    if (error != null) {
      return <p className="text-danger">{t(`${I18N_PREFIX}.fetch_error`)}</p>;
    }
    const totalCount = data?.[0]?.totalCount;
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
        <InfiniteScroll
          swrInifiniteResponse={swrInfiniteResponse}
          isReachingEnd={isReachingEnd}
        >
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
                      ? dateFnsFormat(
                          new Date(user.lastLoginAt),
                          'yyyy-MM-dd HH:mm',
                        )
                      : t(`${I18N_PREFIX}.never_logged_in`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </InfiniteScroll>
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
