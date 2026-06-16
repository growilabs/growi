import { useCallback } from 'react';
import { pathUtils } from '@growi/core/dist/utils';
import type { ItemInstance } from '@headless-tree/core';
import { useTranslation } from 'next-i18next';
import { basename, dirname, resolve } from 'pathe';

import { apiv3Put } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import type { IPageForItem } from '~/interfaces/page';
import { mutatePageTree } from '~/stores/page-listing';

import { CREATING_PAGE_VIRTUAL_ID } from '../constants/_inner';
import { usePageTreeInformationUpdate } from '../states/page-tree-update';

type RenameResult = {
  success: boolean;
  oldPath?: string;
  newPath?: string;
  error?: Error;
};

type UsePageRenameReturn = {
  /**
   * Rename a page
   */
  rename: (
    item: ItemInstance<IPageForItem>,
    newName: string,
  ) => Promise<RenameResult>;

  /**
   * Get the current page name (basename) from item
   */
  getPageName: (item: ItemInstance<IPageForItem>) => string;

  /**
   * Check if item is in renaming mode
   */
  isRenaming: (item: ItemInstance<IPageForItem>) => boolean;
};

/**
 * Hook for page rename logic
 * Separates business logic from UI for renamingFeature integration
 */
export const usePageRename = (): UsePageRenameReturn => {
  const { t } = useTranslation();
  const { notifyUpdateItems } = usePageTreeInformationUpdate();

  const getPageName = useCallback(
    (item: ItemInstance<IPageForItem>): string => {
      const page = item.getItemData();
      // Return empty string for placeholder node (new page creation)
      if (page._id === CREATING_PAGE_VIRTUAL_ID) {
        return '';
      }
      return basename(page.path ?? '');
    },
    [],
  );

  const isRenaming = useCallback(
    (item: ItemInstance<IPageForItem>): boolean => {
      return item.isRenaming?.() ?? false;
    },
    [],
  );

  const rename = useCallback(
    async (
      item: ItemInstance<IPageForItem>,
      newName: string,
    ): Promise<RenameResult> => {
      const page = item.getItemData();
      const oldPath = page.path;

      // Trim and validate
      const trimmedName = newName.trim();
      if (trimmedName === '') {
        return { success: false };
      }

      // Build new path
      const parentPath = pathUtils.addTrailingSlash(dirname(oldPath ?? ''));
      const newPagePath = resolve(parentPath, trimmedName);

      // No change needed
      if (newPagePath === oldPath) {
        return { success: true, oldPath, newPath: newPagePath };
      }

      try {
        await apiv3Put('/pages/rename', {
          pageId: page._id,
          revisionId: page.revision,
          newPagePath,
        });

        // Mutate page tree
        mutatePageTree();

        // Notify headless-tree to update
        const parentId = item.getParent()?.getId();
        if (parentId) {
          notifyUpdateItems([parentId]);
        }

        toastSuccess(t('renamed_pages', { path: oldPath }));

        return { success: true, oldPath, newPath: newPagePath };
      } catch (err) {
        toastError(err);
        return { success: false, oldPath, error: err as Error };
      }
    },
    [t, notifyUpdateItems],
  );

  return {
    rename,
    getPageName,
    isRenaming,
  };
};
