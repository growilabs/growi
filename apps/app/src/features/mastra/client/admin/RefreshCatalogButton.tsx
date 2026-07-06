import type { JSX } from 'react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'next-i18next';
import { Button } from 'reactstrap';

import { ConfirmModal } from '~/client/components/Admin/App/ConfirmModal';
import { apiv3Post } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';

import type { RefreshModelCatalogResponse } from '../../interfaces/refresh-model-catalog-response';

interface RefreshCatalogButtonProps {
  /**
   * Invalidate EVERY provider's cached selectable-model list. The refresh replaces
   * the models.dev snapshot server-side for ALL providers, so a provider-scoped
   * mutate would leave other visited providers' immutable caches pre-refresh until
   * a page reload.
   */
  readonly invalidateAllProviders: () => Promise<void>;
}

/**
 * The "refresh model catalog" action for the models section header: a link-styled
 * button that opens a confirmation FIRST — the refresh triggers server-side OUTBOUND
 * communication to models.dev, so it runs only after the admin explicitly confirms
 * — then POSTs the re-ingest and invalidates every cached provider list.
 *
 * Intentionally NOT disabled in env-only mode: the catalog is a server-side cache of
 * public model metadata, not an AI setting, and env-only deployments (e.g.
 * GROWI.cloud) are a primary audience of this action.
 */
export const RefreshCatalogButton = (
  props: RefreshCatalogButtonProps,
): JSX.Element => {
  const { invalidateAllProviders } = props;
  const { t } = useTranslation('admin');

  const [isRefreshing, setRefreshing] = useState(false);
  const [isConfirmOpen, setConfirmOpen] = useState(false);

  const openConfirm = useCallback((): void => {
    setConfirmOpen(true);
  }, []);
  const cancelConfirm = useCallback((): void => {
    setConfirmOpen(false);
  }, []);
  const confirmRefresh = useCallback(async (): Promise<void> => {
    setConfirmOpen(false);
    setRefreshing(true);
    try {
      await apiv3Post<RefreshModelCatalogResponse>(
        '/ai-settings/refresh-model-catalog',
      );
      await invalidateAllProviders();
      toastSuccess(t('ai_settings.refresh_model_catalog_success'));
    } catch {
      // The server answers a generic 500 on failure (the last-good catalog
      // stays in effect) — surface the localized failure message instead.
      toastError(t('ai_settings.refresh_model_catalog_failed'));
    } finally {
      setRefreshing(false);
    }
  }, [invalidateAllProviders, t]);

  return (
    <>
      <Button
        type="button"
        color="link"
        size="sm"
        className="ms-auto p-0 d-inline-flex align-items-center"
        disabled={isRefreshing}
        onClick={openConfirm}
      >
        <span
          className="material-symbols-outlined fs-6 me-1"
          aria-hidden="true"
        >
          refresh
        </span>
        {t('ai_settings.refresh_model_catalog')}
      </Button>
      <ConfirmModal
        isModalOpen={isConfirmOpen}
        warningMessage={t('ai_settings.refresh_model_catalog_confirmation')}
        supplymentaryMessage={null}
        confirmButtonTitle={t('ai_settings.refresh_model_catalog_confirm')}
        onConfirm={confirmRefresh}
        onCancel={cancelConfirm}
      />
    </>
  );
};
