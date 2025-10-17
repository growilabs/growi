import { useCallback } from 'react';

import type { IPagePopulatedToShowRevision } from '@growi/core';
import { useTranslation } from 'next-i18next';

import { apiv3Put } from '~/client/util/apiv3-client';
import { toastSuccess, toastError } from '~/client/util/toastr';
import { useFetchCurrentPage, useSetIsUntitledPage } from '~/states/page';
import { mutatePageTree, mutatePageList, mutateRecentlyUpdated } from '~/stores/page-listing';


type PagePathRenameHandler = (newPagePath: string, onRenameFinish?: () => void, onRenameFailure?: () => void, onRenamedSkipped?: () => void) => Promise<void>

export const usePagePathRenameHandler = (
    currentPage?: IPagePopulatedToShowRevision | null,
): PagePathRenameHandler => {

  const { t } = useTranslation();
  const { fetchCurrentPage } = useFetchCurrentPage();
  const setIsUntitledPage = useSetIsUntitledPage();

  const pagePathRenameHandler = useCallback(async(newPagePath, onRenameFinish, onRenameFailure) => {

    if (currentPage == null) {
      return;
    }

    if (newPagePath === currentPage.path || newPagePath === '') {
      onRenameFinish?.();
      return;
    }

    const onRenamed = (fromPath: string | undefined, toPath: string) => {
      mutatePageTree();
      mutateRecentlyUpdated();
      mutatePageList();
      setIsUntitledPage(false);

      if (currentPage.path === fromPath || currentPage.path === toPath) {
        fetchCurrentPage();
      }
    };

    try {
      await apiv3Put('/pages/rename', {
        pageId: currentPage._id,
        revisionId: currentPage.revision?._id,
        newPagePath,
      });

      onRenamed(currentPage.path, newPagePath);
      onRenameFinish?.();

      toastSuccess(t('renamed_pages', { path: currentPage.path }));
    }
    catch (err) {
      onRenameFailure?.();
      toastError(err);
    }
  }, [currentPage, fetchCurrentPage, setIsUntitledPage, t]);

  return pagePathRenameHandler;
};
