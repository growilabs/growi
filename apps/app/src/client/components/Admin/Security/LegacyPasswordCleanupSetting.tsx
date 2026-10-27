import type { JSX } from 'react';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'next-i18next';

import { apiv3Delete } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import type { DeleteLegacyPasswordsResponse } from '~/interfaces/password-hash-status';
import {
  fetchPasswordHashStatus,
  useSWRxPasswordHashStatus,
} from '~/stores/admin/password-hash-status';
import loggerFactory from '~/utils/logger';

import { ConfirmModal } from '../App/ConfirmModal';
import { ErrorWithRetry } from './ErrorWithRetry';
import {
  PasswordHashCountTable,
  sumLegacyOnly,
} from './PasswordHashCountTable';
import { UnmigratedUserList } from './UnmigratedUserList';

const logger = loggerFactory(
  'growi:client:admin:security:LegacyPasswordCleanupSetting',
);

const I18N_PREFIX = 'security_settings.legacy_password_cleanup';

export const LegacyPasswordCleanupSetting = (): JSX.Element | null => {
  const { t } = useTranslation('admin');
  const {
    data: counts,
    error,
    isLoading,
    isValidating,
    mutate,
  } = useSWRxPasswordHashStatus();
  const [isModalOpen, setIsModalOpen] = useState(false);
  // True while the pre-open refetch or the deletion and its refetch run, so a
  // repeated click can neither open the modal twice nor start a second delete.
  const [isBusy, setIsBusy] = useState(false);
  // The modal keeps its confirm button clickable while it fades out; a ref
  // rejects a second confirm without depending on when the busy state renders.
  const isDeletingRef = useRef(false);

  const hasFetchError = error != null;
  const isDeleteDisabled =
    isBusy || isLoading || hasFetchError || counts == null || counts.both === 0;

  // Refetch before opening so the modal shows the count that will actually be
  // deleted. Passing the fetch promise makes a failed refetch reject instead of
  // resolving with the stale cached counts, as a bare mutate() would.
  const onDeleteClick = useCallback(async () => {
    setIsBusy(true);
    try {
      const fresh = await mutate(fetchPasswordHashStatus(), {
        revalidate: false,
      });
      if (fresh != null && fresh.both > 0) {
        setIsModalOpen(true);
      }
    } catch (err) {
      logger.error('Failed to refetch the password hash status', err);
      toastError(t(`${I18N_PREFIX}.fetch_error`));
    } finally {
      setIsBusy(false);
    }
  }, [mutate, t]);

  const onConfirm = useCallback(async () => {
    if (isDeletingRef.current) {
      return;
    }
    isDeletingRef.current = true;
    setIsModalOpen(false);
    setIsBusy(true);
    try {
      const { data } = await apiv3Delete<DeleteLegacyPasswordsResponse>(
        '/security-setting/legacy-passwords',
      );
      // A redirect can yield an HTML body with HTTP 200, as the status hook guards against.
      if (typeof data?.unsetCount !== 'number') {
        throw new Error('Delete response has no unsetCount');
      }
      toastSuccess(t(`${I18N_PREFIX}.success`, { count: data.unsetCount }));
    } catch (err) {
      logger.error('Failed to delete legacy passwords', err);
      toastError(t(`${I18N_PREFIX}.delete_error`));
    }
    try {
      // Refetch on failure too: the deletion may have partially applied.
      await mutate();
    } finally {
      isDeletingRef.current = false;
      setIsBusy(false);
    }
  }, [mutate, t]);

  // Nothing to show while loading, and nothing left to clean up once no
  // legacy password remains. Hooks above must stay before these early returns.
  if (error == null && counts == null) {
    return null;
  }
  if (counts != null && counts.both === 0 && sumLegacyOnly(counts) === 0) {
    return null;
  }

  return (
    <div className="mb-5">
      <h2 className="border-bottom mb-4">{t(`${I18N_PREFIX}.title`)}</h2>
      <p className="mb-3">{t(`${I18N_PREFIX}.description`)}</p>

      {hasFetchError ? (
        <div className="mb-3">
          <ErrorWithRetry
            message={t(`${I18N_PREFIX}.fetch_error`)}
            isRetrying={isValidating}
            onRetry={() => mutate()}
          />
        </div>
      ) : (
        counts != null && (
          <>
            <PasswordHashCountTable counts={counts} />
            <p className="form-text text-muted">
              {t(`${I18N_PREFIX}.both_is_target_hint`)}
            </p>
          </>
        )
      )}

      <button
        type="button"
        className="btn btn-danger"
        disabled={isDeleteDisabled}
        onClick={onDeleteClick}
      >
        {t(`${I18N_PREFIX}.delete_button`)}
      </button>

      <UnmigratedUserList />

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
    </div>
  );
};
