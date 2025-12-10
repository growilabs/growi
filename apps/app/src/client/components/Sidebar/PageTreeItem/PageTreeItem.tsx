import type { FC } from 'react';
import { useCallback } from 'react';

import path from 'path';

import type { IPageToDeleteWithMeta } from '@growi/core/dist/interfaces';
import { getIdStringForRef } from '@growi/core/dist/interfaces';
import { pathUtils } from '@growi/core/dist/utils';
import { useTranslation } from 'next-i18next';
import { useRouter } from 'next/router';

import { toastSuccess } from '~/client/util/toastr';
import type { TreeItemProps } from '~/features/page-tree';
import {
  usePageTreeInformationUpdate, usePageRename, usePageCreate,
  usePlaceholderRenameEffect,
} from '~/features/page-tree';
import { TreeNameInput, TreeItemLayout } from '~/features/page-tree/components';
import type { IPageForItem } from '~/interfaces/page';
import type { OnDeletedFunction, OnDuplicatedFunction } from '~/interfaces/ui';
import { useCurrentPagePath, useFetchCurrentPage } from '~/states/page';
import { usePageDeleteModalActions } from '~/states/ui/modal/page-delete';
import type { IPageForPageDuplicateModal } from '~/states/ui/modal/page-duplicate';
import { usePageDuplicateModalActions } from '~/states/ui/modal/page-duplicate';
import { mutateAllPageInfo } from '~/stores/page';
import { mutatePageTree, mutatePageList } from '~/stores/page-listing';
import { mutateSearching } from '~/stores/search';


import { CountBadgeForPageTreeItem } from './CountBadgeForPageTreeItem';
import { usePageItemControl } from './use-page-item-control';

import styles from './PageTreeItem.module.scss';

const moduleClass = styles['page-tree-item'] ?? '';


export const pageTreeItemSize = 40; // in px


export const PageTreeItem: FC<TreeItemProps> = ({
  item,
  targetPath,
  targetPathOrId,
  isWipPageShown,
  isEnableActions = false,
  isReadOnlyUser = false,
  onToggle,
}) => {
  const { t } = useTranslation();
  const router = useRouter();

  const itemData = item.getItemData();

  const currentPagePath = useCurrentPagePath();
  const { fetchCurrentPage } = useFetchCurrentPage();

  const { open: openDuplicateModal } = usePageDuplicateModalActions();
  const { open: openDeleteModal } = usePageDeleteModalActions();
  const { notifyUpdateItems } = usePageTreeInformationUpdate();

  const onClickDuplicateMenuItem = useCallback((page: IPageForPageDuplicateModal) => {
    const duplicatedHandler: OnDuplicatedFunction = (fromPath) => {
      toastSuccess(t('duplicated_pages', { fromPath }));

      mutatePageTree();
      mutateSearching();
      mutatePageList();

      // Notify headless-tree update
      const parentIds = itemData.parent != null ? [getIdStringForRef(itemData.parent)] : undefined;
      notifyUpdateItems(parentIds);
    };

    openDuplicateModal(page, { onDuplicated: duplicatedHandler });
  }, [openDuplicateModal, t, notifyUpdateItems, itemData.parent]);

  const onClickDeleteMenuItem = useCallback((page: IPageToDeleteWithMeta) => {
    const onDeletedHandler: OnDeletedFunction = (pathOrPathsToDelete, isRecursively, isCompletely) => {
      if (typeof pathOrPathsToDelete !== 'string') {
        return;
      }

      if (isCompletely) {
        toastSuccess(t('deleted_pages_completely', { path: pathOrPathsToDelete }));
      }
      else {
        toastSuccess(t('deleted_pages', { path: pathOrPathsToDelete }));
      }

      mutatePageTree();
      mutateSearching();
      mutatePageList();
      mutateAllPageInfo();

      if (currentPagePath === pathOrPathsToDelete) {
        fetchCurrentPage({ force: true });
        router.push(isCompletely ? path.dirname(pathOrPathsToDelete) : `/trash${pathOrPathsToDelete}`);
      }

      // Notify headless-tree update
      const parentIds = itemData.parent != null ? [getIdStringForRef(itemData.parent)] : undefined;
      notifyUpdateItems(parentIds);
    };

    openDeleteModal([page], { onDeleted: onDeletedHandler });
  }, [openDeleteModal, t, currentPagePath, fetchCurrentPage, router, itemData.parent, notifyUpdateItems]);

  const { Control } = usePageItemControl();

  // Rename feature from usePageRename hook
  const { isRenaming } = usePageRename();

  // Page create feature
  const { cancelCreating, CreateButton, isCreatingPlaceholder } = usePageCreate();

  // Manage placeholder renaming mode (auto-start, track, and cancel on Esc)
  usePlaceholderRenameEffect({
    item,
    onCancelCreate: cancelCreating,
  });

  const itemSelectedHandler = useCallback((page: IPageForItem) => {
    if (page.path == null || page._id == null) return;

    const link = pathUtils.returnPathForURL(page.path, page._id);
    router.push(link);
  }, [router]);

  const itemSelectedByWheelClickHandler = useCallback((page: IPageForItem) => {
    if (page.path == null || page._id == null) return;

    const url = pathUtils.returnPathForURL(page.path, page._id);
    window.open(url, '_blank');
  }, []);

  return (
    <TreeItemLayout
      className={moduleClass}
      item={item}
      targetPath={targetPath}
      targetPathOrId={targetPathOrId ?? undefined}
      isWipPageShown={isWipPageShown}
      isEnableActions={isEnableActions}
      isReadOnlyUser={isReadOnlyUser}
      onClick={itemSelectedHandler}
      onWheelClick={itemSelectedByWheelClickHandler}
      onToggle={onToggle}
      onClickDuplicateMenuItem={onClickDuplicateMenuItem}
      onClickDeleteMenuItem={onClickDeleteMenuItem}
      customEndComponents={[CountBadgeForPageTreeItem]}
      customHoveredEndComponents={[Control, CreateButton]}
      showAlternativeContent={isRenaming(item) || isCreatingPlaceholder(item)}
      customAlternativeComponents={[TreeNameInput]}
    />
  );
};
