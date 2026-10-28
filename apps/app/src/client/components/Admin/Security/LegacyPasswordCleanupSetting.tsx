import type { JSX } from 'react';
import { useTranslation } from 'next-i18next';

import type { PasswordHashFormatCounts } from '~/interfaces/password-hash-status';
import { useSWRxPasswordHashStatus } from '~/stores/admin/password-hash-status';

import { ConfirmModal } from '../App/ConfirmModal';
import { ErrorWithRetry } from './ErrorWithRetry';
import {
  PasswordHashCountTable,
  sumLegacyOnly,
} from './PasswordHashCountTable';
import { UnmigratedUserList } from './UnmigratedUserList';
import { useLegacyPasswordDelete } from './useLegacyPasswordDelete';

const I18N_PREFIX = 'security_settings.legacy_password_cleanup';

type StatusBodyProps = {
  counts: PasswordHashFormatCounts | undefined;
  hasFetchError: boolean;
  isRetrying: boolean;
  onRetry: () => void;
};

const StatusBody = ({
  counts,
  hasFetchError,
  isRetrying,
  onRetry,
}: StatusBodyProps): JSX.Element | null => {
  const { t } = useTranslation('admin');
  if (hasFetchError) {
    return (
      <div className="mb-3">
        <ErrorWithRetry
          message={t(`${I18N_PREFIX}.fetch_error`)}
          isRetrying={isRetrying}
          onRetry={onRetry}
        />
      </div>
    );
  }
  if (counts == null) {
    return null;
  }
  return (
    <>
      <PasswordHashCountTable counts={counts} />
      <p className="form-text text-muted">
        {t(`${I18N_PREFIX}.both_is_target_hint`)}
      </p>
    </>
  );
};

type DeleteConfirmModalProps = {
  isOpen: boolean;
  targetCount: number;
  onConfirm: () => void;
  onCancel: () => void;
};

const DeleteConfirmModal = ({
  isOpen,
  targetCount,
  onConfirm,
  onCancel,
}: DeleteConfirmModalProps): JSX.Element => {
  const { t } = useTranslation('admin');
  return (
    <ConfirmModal
      isModalOpen={isOpen}
      title={t(`${I18N_PREFIX}.confirm.title`)}
      warningMessage={t(`${I18N_PREFIX}.confirm.warning`, {
        count: targetCount,
      })}
      supplymentaryMessage={t(`${I18N_PREFIX}.confirm.downgrade_warning`)}
      confirmButtonTitle={t(`${I18N_PREFIX}.confirm.submit`)}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
};

// Nothing to show while loading, and nothing left to clean up once no legacy
// password remains; a fetch error keeps the section visible.
const isSectionHidden = (
  counts: PasswordHashFormatCounts | undefined,
  hasFetchError: boolean,
): boolean =>
  counts == null
    ? !hasFetchError
    : counts.both === 0 && sumLegacyOnly(counts) === 0;

export const LegacyPasswordCleanupSetting = (): JSX.Element | null => {
  const { t } = useTranslation('admin');
  const {
    data: counts,
    error,
    isValidating,
    mutate,
  } = useSWRxPasswordHashStatus();
  const { isModalOpen, isBusy, openConfirm, confirm, cancel } =
    useLegacyPasswordDelete(mutate);

  if (isSectionHidden(counts, error != null)) {
    return null;
  }
  // While shown, counts is missing only after a fetch error.
  const isDeleteDisabled =
    isBusy || error != null || counts == null || counts.both === 0;

  return (
    <div className="mb-5">
      <h2 className="border-bottom mb-4">{t(`${I18N_PREFIX}.title`)}</h2>
      <p className="mb-3">{t(`${I18N_PREFIX}.description`)}</p>
      <StatusBody
        counts={counts}
        hasFetchError={error != null}
        isRetrying={isValidating}
        onRetry={() => mutate()}
      />
      <button
        type="button"
        className="btn btn-danger"
        disabled={isDeleteDisabled}
        onClick={openConfirm}
      >
        {t(`${I18N_PREFIX}.delete_button`)}
      </button>
      <UnmigratedUserList />
      <DeleteConfirmModal
        isOpen={isModalOpen}
        targetCount={counts?.both ?? 0}
        onConfirm={confirm}
        onCancel={cancel}
      />
    </div>
  );
};
