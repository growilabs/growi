import { useState } from 'react';
import { useTranslation } from 'next-i18next';

import type { IPasswordHashUnmigratedUser } from '~/interfaces/password-hash-migration';
import { useSWRxPasswordHashUnmigratedUsers } from '~/stores/admin/password-hash-unmigrated-users';

import PaginationWrapper from '../../../PaginationWrapper';

const K = 'security_settings.password_hash_migration';

/**
 * UserStatus.STATUS_ACTIVE. Rows that are not active are marked, because an
 * administrator cannot prompt a suspended or invited account into migrating.
 */
const STATUS_ACTIVE = 2;

const UserRow = (props: { user: IPasswordHashUnmigratedUser }): JSX.Element => {
  const { user } = props;
  const { t } = useTranslation('admin');

  return (
    <tr>
      <td>
        {user.username}
        {user.status !== STATUS_ACTIVE && (
          <span className="badge text-bg-secondary ms-2">
            {t(`${K}.list_non_active`)}
          </span>
        )}
      </td>
      <td>{user.email ?? '-'}</td>
      <td>
        {user.lastLoginAt != null ? (
          new Date(user.lastLoginAt).toLocaleString()
        ) : (
          <span className="text-muted">{t(`${K}.list_never_logged_in`)}</span>
        )}
      </td>
      <td>
        {user.hasExternalAccount ? (
          <span className="badge text-bg-warning">
            {t(`${K}.list_has_external_account`)}
          </span>
        ) : (
          <span className="text-muted">-</span>
        )}
      </td>
    </tr>
  );
};

/**
 * Who has not migrated yet.
 *
 * Collapsed by default and fetched only once opened: the count alone is enough for
 * the common case, and the list costs a document read per row.
 *
 * Sorted newest login first by the server. That ordering is the point of the
 * screen rather than a detail — a user who logged in recently and is still
 * unmigrated is not signing in with their password, so asking them to log in will
 * never clear them. Those rows surface first, and the external-account column
 * corroborates why.
 */
export const UnmigratedUserList = (props: {
  totalCount: number;
}): JSX.Element => {
  const { totalCount } = props;
  const { t } = useTranslation('admin');

  const [isOpen, setOpen] = useState(false);
  const [page, setPage] = useState(1);

  const { data, error, isLoading } = useSWRxPasswordHashUnmigratedUsers(
    page,
    isOpen,
  );

  if (totalCount === 0) {
    return <></>;
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        className="btn btn-outline-secondary btn-sm"
        onClick={() => setOpen(!isOpen)}
      >
        {/* Hidden from the accessible name: the ligature text would otherwise be
            read out as part of the label ("expand_more Show unmigrated users"). */}
        <span className="material-symbols-outlined me-1" aria-hidden="true">
          {isOpen ? 'expand_less' : 'expand_more'}
        </span>
        {t(`${K}.list_toggle`, { count: totalCount })}
      </button>

      {isOpen && (
        <div className="mt-3">
          {isLoading && (
            <div className="text-muted">
              <span
                className="spinner-border spinner-border-sm me-1"
                role="status"
              />
              {t(`${K}.loading`)}
            </div>
          )}

          {error != null && (
            <div className="alert alert-danger">
              {t(`${K}.list_load_failed`)}
            </div>
          )}

          {data != null && (
            <>
              <p className="text-muted small">{t(`${K}.list_hint`)}</p>

              <div className="table-responsive">
                <table className="table table-bordered table-sm">
                  <thead>
                    <tr>
                      <th>{t(`${K}.list_column_username`)}</th>
                      <th>{t(`${K}.list_column_email`)}</th>
                      <th>{t(`${K}.list_column_last_login`)}</th>
                      <th>{t(`${K}.list_column_external_account`)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.map((user) => (
                      <UserRow key={user._id} user={user} />
                    ))}
                  </tbody>
                </table>
              </div>

              <PaginationWrapper
                activePage={data.page}
                changePage={setPage}
                totalItemsCount={data.totalCount}
                pagingLimit={data.limit}
                align="center"
                size="sm"
              />
            </>
          )}
        </div>
      )}
    </div>
  );
};
