import type { JSX } from 'react';
import { useState } from 'react';
import { format as dateFnsFormat } from 'date-fns/format';
import { useTranslation } from 'next-i18next';

import PaginationWrapper from '~/client/components/PaginationWrapper';
import {
  UNMIGRATED_USERS_PAGE_SIZE,
  useSWRxPasswordHashUnmigratedUsers,
} from '~/stores/admin/password-hash-unmigrated-users';

const I18N_PREFIX = 'security_settings.legacy_password_cleanup.unmigrated_list';

export const UnmigratedUserList = (): JSX.Element => {
  const { t } = useTranslation('admin');
  const [page, setPage] = useState(1);
  const { data, error } = useSWRxPasswordHashUnmigratedUsers(page);

  const renderBody = (): JSX.Element | null => {
    if (error != null) {
      return <p className="text-danger">{t(`${I18N_PREFIX}.fetch_error`)}</p>;
    }
    if (data == null) {
      return null;
    }
    if (data.totalCount === 0) {
      return <p className="text-muted">{t(`${I18N_PREFIX}.empty`)}</p>;
    }
    return (
      <>
        <table className="table table-bordered table-sm w-auto mb-3">
          <thead>
            <tr>
              <th>{t(`${I18N_PREFIX}.column.username`)}</th>
              <th>{t(`${I18N_PREFIX}.column.email`)}</th>
              <th>{t(`${I18N_PREFIX}.column.last_login`)}</th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((user) => (
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
        {data.totalCount > UNMIGRATED_USERS_PAGE_SIZE && (
          <PaginationWrapper
            activePage={page}
            changePage={setPage}
            totalItemsCount={data.totalCount}
            pagingLimit={UNMIGRATED_USERS_PAGE_SIZE}
          />
        )}
      </>
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
