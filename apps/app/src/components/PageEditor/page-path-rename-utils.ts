import { useCallback } from 'react';

import type { IPagePopulatedToShowRevision } from '@growi/core';
import { useTranslation } from 'next-i18next';

import { apiv3Put } from '~/client/util/apiv3-client';
import { toastSuccess, toastError } from '~/client/util/toastr';
import { useSWRMUTxCurrentPage } from '~/stores/page';
import { mutatePageTree, mutatePageList } from '~/stores/page-listing';
import { useIsUntitledPage } from '~/stores/ui';


type PagePathRenameHandler = (newPagePath: string, onRenameFinish?: () => void, onRenameFailure?: () => void, onRenamedSkipped?: () => void) => Promise<void>

export const usePagePathRenameHandler = (
    currentPage?: IPagePopulatedToShowRevision | null,
): PagePathRenameHandler => {

  const { t } = useTranslation();
  const { trigger: mutateCurrentPage } = useSWRMUTxCurrentPage();
  const { mutate: mutateIsUntitledPage } = useIsUntitledPage();

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
      mutatePageList();
      mutateIsUntitledPage(false);

      if (currentPage.path === fromPath || currentPage.path === toPath) {
        mutateCurrentPage();
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
  }, [currentPage, mutateCurrentPage, mutateIsUntitledPage, t]);

  return pagePathRenameHandler;
};
