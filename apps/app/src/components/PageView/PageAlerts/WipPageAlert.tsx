import React, { type JSX, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useCurrentPageData, useFetchCurrentPage } from '~/states/page';

export const WipPageAlert = (): JSX.Element => {
  const { t } = useTranslation();
  const currentPage = useCurrentPageData();
  const { fetchCurrentPage } = useFetchCurrentPage();

  const clickPagePublishButton = useCallback(async () => {
    const pageId = currentPage?._id;

    if (pageId == null) {
      return;
    }

    try {
      // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
      const publish = (await import('~/client/services/page-operation'))
        .publish;
      await publish(pageId);

      await fetchCurrentPage({ force: true });

      const mutatePageTree = (await import('~/stores/page-listing'))
        .mutatePageTree;
      await mutatePageTree();

      const mutateRecentlyUpdated = (await import('~/stores/page-listing'))
        .mutateRecentlyUpdated;
      await mutateRecentlyUpdated();

      // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
      const toastSuccess = (await import('~/client/util/toastr')).toastSuccess;
      toastSuccess(t('wip_page.success_publish_page'));
    } catch {
      // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
      const toastError = (await import('~/client/util/toastr')).toastError;
      toastError(t('wip_page.fail_publish_page'));
    }
  }, [currentPage?._id, fetchCurrentPage, t]);

  if (!currentPage?.wip) {
    return <></>;
  }

  return (
    <p className="d-flex align-items-center alert alert-secondary py-3 px-4">
      <span className="material-symbols-outlined me-1 fs-5">info</span>
      <span>{t('wip_page.alert')}</span>
      <button
        type="button"
        className="btn btn-outline-secondary ms-auto"
        onClick={clickPagePublishButton}
      >
        {t('wip_page.publish_page')}
      </button>
    </p>
  );
};
