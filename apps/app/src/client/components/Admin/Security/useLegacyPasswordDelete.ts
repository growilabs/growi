import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'next-i18next';
import type { KeyedMutator } from 'swr';

import { apiv3Delete } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import type {
  DeleteLegacyPasswordsResponse,
  PasswordHashFormatCounts,
} from '~/interfaces/password-hash-status';
import { fetchPasswordHashStatus } from '~/stores/admin/password-hash-status';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:client:admin:security:useLegacyPasswordDelete',
);

const I18N_PREFIX = 'security_settings.legacy_password_cleanup';

type LegacyPasswordDelete = {
  readonly isModalOpen: boolean;
  readonly isBusy: boolean;
  readonly openConfirm: () => Promise<void>;
  readonly confirm: () => Promise<void>;
  readonly cancel: () => void;
};

const requestLegacyPasswordDelete = async (): Promise<number> => {
  const { data } = await apiv3Delete<DeleteLegacyPasswordsResponse>(
    '/security-setting/legacy-passwords',
  );
  // A redirect can yield an HTML body with HTTP 200, as the status hook guards against.
  if (typeof data?.unsetCount !== 'number') {
    throw new Error('Delete response has no unsetCount');
  }
  return data.unsetCount;
};

type DeleteExecution = {
  readonly isDeleting: boolean;
  readonly execute: () => Promise<void>;
};

const useDeleteExecution = (
  mutate: KeyedMutator<PasswordHashFormatCounts>,
): DeleteExecution => {
  const { t } = useTranslation('admin');
  const [isDeleting, setIsDeleting] = useState(false);
  // The modal keeps its confirm button clickable while it fades out; a ref
  // rejects a second confirm without depending on when the state renders.
  const isDeletingRef = useRef(false);

  const execute = useCallback(async () => {
    if (isDeletingRef.current) {
      return;
    }
    isDeletingRef.current = true;
    setIsDeleting(true);
    try {
      const unsetCount = await requestLegacyPasswordDelete();
      toastSuccess(t(`${I18N_PREFIX}.success`, { count: unsetCount }));
    } catch (err) {
      logger.error('Failed to delete legacy passwords', err);
      toastError(t(`${I18N_PREFIX}.delete_error`));
    }
    try {
      // Refetch on failure too: the deletion may have partially applied.
      await mutate();
    } finally {
      isDeletingRef.current = false;
      setIsDeleting(false);
    }
  }, [mutate, t]);

  return { isDeleting, execute };
};

/**
 * Takes the status hook's mutate instead of calling the status hook itself, so
 * the section does not subscribe twice and refetch twice on mount.
 */
export const useLegacyPasswordDelete = (
  mutate: KeyedMutator<PasswordHashFormatCounts>,
): LegacyPasswordDelete => {
  const { t } = useTranslation('admin');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isRefetching, setIsRefetching] = useState(false);
  const { isDeleting, execute } = useDeleteExecution(mutate);

  // Refetch before opening so the modal shows the count that will actually be
  // deleted. Passing the fetch promise makes a failed refetch reject instead of
  // resolving with the stale cached counts, as a bare mutate() would.
  const openConfirm = useCallback(async () => {
    setIsRefetching(true);
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
      setIsRefetching(false);
    }
  }, [mutate, t]);

  const confirm = useCallback(async () => {
    setIsModalOpen(false);
    await execute();
  }, [execute]);

  const cancel = useCallback(() => setIsModalOpen(false), []);

  return {
    isModalOpen,
    // Blocks a repeated click from opening the modal twice or deleting twice.
    isBusy: isRefetching || isDeleting,
    openConfirm,
    confirm,
    cancel,
  };
};
