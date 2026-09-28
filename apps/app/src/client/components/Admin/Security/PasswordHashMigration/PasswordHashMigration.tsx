import { useCallback, useState } from 'react';
import { useTranslation } from 'next-i18next';

import { toastError, toastSuccess } from '~/client/util/toastr';
import type { IPasswordHashFormatDistribution } from '~/interfaces/password-hash-migration';
import {
  postPasswordHashCleanup,
  useSWRxPasswordHashMigrationStatus,
} from '~/stores/admin/password-hash-migration';

import { CleanupConfirmModal } from './CleanupConfirmModal';

const DistributionTable = (props: {
  distribution: IPasswordHashFormatDistribution;
}): JSX.Element => {
  const { distribution } = props;
  const { t } = useTranslation('admin');

  const rows: { key: string; count: number; isTarget?: boolean }[] = [
    { key: 'legacy_only', count: distribution.legacyOnly },
    { key: 'both', count: distribution.both, isTarget: true },
    { key: 'upgraded_only', count: distribution.upgradedOnly },
    { key: 'no_password', count: distribution.noPassword },
  ];

  return (
    <div className="table-responsive">
      <table className="table table-bordered">
        <thead>
          <tr>
            <th>
              {t('security_settings.password_hash_migration.column_format')}
            </th>
            <th className="text-end">
              {t('security_settings.password_hash_migration.column_count')}
            </th>
            <th>
              {t('security_settings.password_hash_migration.column_meaning')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>
                {t(
                  `security_settings.password_hash_migration.format_${row.key}`,
                )}
                {row.isTarget && (
                  <span className="badge text-bg-primary ms-2">
                    {t(
                      'security_settings.password_hash_migration.cleanup_target',
                    )}
                  </span>
                )}
              </td>
              <td className="text-end">{row.count}</td>
              <td className="text-muted">
                {t(
                  `security_settings.password_hash_migration.meaning_${row.key}`,
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/**
 * Admin control for finishing the SHA-256 -> scrypt password-hash migration.
 *
 * Shows the format distribution *before* offering the button, because the cleanup
 * has a precondition the administrator cannot otherwise see: it refuses to run
 * while any ACTIVE user has yet to log in. Surfacing that up front is the main
 * advantage this has over the CLI, where the same condition only appears as an
 * abort after the fact.
 */
export const PasswordHashMigration = (): JSX.Element => {
  const { t } = useTranslation('admin');
  const { data, error, isLoading, mutate } =
    useSWRxPasswordHashMigrationStatus();

  const [isModalOpen, setModalOpen] = useState(false);
  const [isExecuting, setExecuting] = useState(false);

  const executeHandler = useCallback(async () => {
    setExecuting(true);
    try {
      const result = await postPasswordHashCleanup();
      toastSuccess(
        t('security_settings.password_hash_migration.cleanup_succeeded', {
          count: result.unset,
        }),
      );
      setModalOpen(false);
      await mutate();
    } catch (err) {
      toastError(err);
    } finally {
      setExecuting(false);
    }
  }, [mutate, t]);

  return (
    <>
      <h3 className="border-bottom mt-5">
        {t('security_settings.password_hash_migration.title')}
      </h3>

      <p className="mt-3">
        {t('security_settings.password_hash_migration.description')}
      </p>

      {isLoading && (
        <div className="text-muted">
          <span
            className="spinner-border spinner-border-sm me-1"
            role="status"
          />
          {t('security_settings.password_hash_migration.loading')}
        </div>
      )}

      {error != null && (
        <div className="alert alert-danger">
          {t('security_settings.password_hash_migration.status_load_failed')}
        </div>
      )}

      {data != null && (
        <>
          <DistributionTable distribution={data.distribution} />

          {data.isCleanupCompleted ? (
            <div className="alert alert-success">
              <span className="material-symbols-outlined me-1">
                check_circle
              </span>
              {t('security_settings.password_hash_migration.already_completed')}
            </div>
          ) : data.isCleanupRunnable ? (
            <div className="alert alert-info">
              {t('security_settings.password_hash_migration.ready_to_cleanup')}
            </div>
          ) : (
            <div className="alert alert-warning">
              {t('security_settings.password_hash_migration.blocked', {
                count: data.distribution.legacyOnlyActive,
              })}
            </div>
          )}

          {data.distribution.legacyOnlyNonActive > 0 && (
            <p className="text-muted small">
              {t('security_settings.password_hash_migration.non_active_note', {
                count: data.distribution.legacyOnlyNonActive,
              })}
            </p>
          )}

          <button
            type="button"
            className="btn btn-danger"
            disabled={!data.isCleanupRunnable || data.isCleanupCompleted}
            onClick={() => setModalOpen(true)}
          >
            {t('security_settings.password_hash_migration.cleanup_button')}
          </button>
        </>
      )}

      <CleanupConfirmModal
        isOpen={isModalOpen}
        isExecuting={isExecuting}
        onClose={() => setModalOpen(false)}
        onConfirm={executeHandler}
      />
    </>
  );
};
