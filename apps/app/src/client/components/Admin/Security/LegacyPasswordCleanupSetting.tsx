import type { JSX } from 'react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'next-i18next';

import { apiv3Delete } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import type { DeleteLegacyPasswordsResponse } from '~/interfaces/password-hash-status';
import { useSWRxPasswordHashStatus } from '~/stores/admin/password-hash-status';

import { ConfirmModal } from '../App/ConfirmModal';

const I18N_PREFIX = 'security_settings.legacy_password_cleanup';

export const LegacyPasswordCleanupSetting = (): JSX.Element => {
  const { t } = useTranslation('admin');
  const {
    data: counts,
    error,
    isLoading,
    mutate,
  } = useSWRxPasswordHashStatus();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const hasFetchError = error != null;
  const isDeleteDisabled =
    isLoading || hasFetchError || counts == null || counts.both === 0;

  const onConfirm = useCallback(async () => {
    setIsModalOpen(false);
    try {
      const { data } = await apiv3Delete<DeleteLegacyPasswordsResponse>(
        '/security-setting/legacy-passwords',
      );
      toastSuccess(t(`${I18N_PREFIX}.success`, { count: data.unsetCount }));
    } catch (_err) {
      toastError(t(`${I18N_PREFIX}.delete_error`));
    }
    // Refetch on failure too: the deletion may have partially applied.
    await mutate();
  }, [mutate, t]);

  return (
    <>
      <h2 className="border-bottom mb-4">{t(`${I18N_PREFIX}.title`)}</h2>
      <p className="mb-3">{t(`${I18N_PREFIX}.description`)}</p>

      {hasFetchError ? (
        <p className="text-danger">{t(`${I18N_PREFIX}.fetch_error`)}</p>
      ) : (
        counts != null && (
          <table className="table table-bordered w-auto mb-3">
            <tbody>
              <tr>
                <th scope="row">
                  {t(`${I18N_PREFIX}.count_label.upgraded_only`)}
                </th>
                <td>{counts.upgradedOnly}</td>
              </tr>
              <tr className="table-warning">
                <th scope="row">{t(`${I18N_PREFIX}.count_label.both`)}</th>
                <td>{counts.both}</td>
              </tr>
              <tr>
                <th scope="row">
                  {t(`${I18N_PREFIX}.count_label.legacy_only`)}
                </th>
                <td>
                  {counts.legacyOnly.active + counts.legacyOnly.nonActive}
                </td>
              </tr>
              <tr>
                <th scope="row" className="ps-4 fw-normal">
                  {t(`${I18N_PREFIX}.count_label.legacy_only_active`)}
                </th>
                <td>{counts.legacyOnly.active}</td>
              </tr>
              <tr>
                <th scope="row" className="ps-4 fw-normal">
                  {t(`${I18N_PREFIX}.count_label.legacy_only_non_active`)}
                </th>
                <td>{counts.legacyOnly.nonActive}</td>
              </tr>
              <tr>
                <th scope="row">
                  {t(`${I18N_PREFIX}.count_label.no_password`)}
                </th>
                <td>{counts.noPassword}</td>
              </tr>
            </tbody>
          </table>
        )
      )}
      {!hasFetchError && counts != null && (
        <p className="form-text text-muted">
          {t(`${I18N_PREFIX}.both_is_target_hint`)}
        </p>
      )}

      <button
        type="button"
        className="btn btn-danger"
        disabled={isDeleteDisabled}
        onClick={() => setIsModalOpen(true)}
      >
        {t(`${I18N_PREFIX}.delete_button`)}
      </button>

      <ConfirmModal
        isModalOpen={isModalOpen}
        title={t(`${I18N_PREFIX}.confirm.title`)}
        warningMessage={t(`${I18N_PREFIX}.confirm.warning`, {
          count: counts?.both ?? 0,
        })}
        supplymentaryMessage={t(`${I18N_PREFIX}.confirm.downgrade_warning`)}
        confirmButtonTitle={t(`${I18N_PREFIX}.confirm.submit`)}
        onConfirm={onConfirm}
        onCancel={() => setIsModalOpen(false)}
      />
    </>
  );
};
