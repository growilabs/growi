import type { FC } from 'react';
import { useCallback } from 'react';

import type { IPageToDeleteWithMeta } from '@growi/core/dist/interfaces';
import { getIdStringForRef } from '@growi/core/dist/interfaces';
import { pathUtils } from '@growi/core/dist/utils';
import { useRouter } from 'next/router';

import { ROOT_PAGE_VIRTUAL_ID } from '~/constants/page-tree';
import type { IPageForItem } from '~/interfaces/page';
import { usePageTreeInformationUpdate } from '~/states/page-tree-update';
import { usePageDeleteModalActions } from '~/states/ui/modal/page-delete';
import type { IPageForPageDuplicateModal } from '~/states/ui/modal/page-duplicate';
import { usePageDuplicateModalActions } from '~/states/ui/modal/page-duplicate';

import type { TreeItemProps } from '../../TreeItem';
import { TreeItemLayout } from '../../TreeItem';
import { NewPageCreateButton } from '../../TreeItem/NewPageInput/NewPageCreateButton';

import { CountBadgeForPageTreeItem } from './CountBadgeForPageTreeItem';
import { usePageItemControl } from './use-page-item-control';

import styles from './PageTreeItem.module.scss';

const moduleClass = styles['page-tree-item'] ?? '';


export const simplifiedPageTreeItemSize = 40; // in px


export const SimplifiedPageTreeItem: FC<TreeItemProps> = ({
  item,
  itemLevel,
  isExpanded,
  targetPath,
  targetPathOrId,
  isWipPageShown,
  isEnableActions = false,
  isReadOnlyUser = false,
  isRenaming,
  renameInputProps,
  onStartCreatePage,
  onToggle,
}) => {
  const router = useRouter();

  const { open: openDuplicateModal } = usePageDuplicateModalActions();
  const { open: openDeleteModal } = usePageDeleteModalActions();
  const { notifyUpdateItems } = usePageTreeInformationUpdate();

  const onClickDuplicateMenuItem = useCallback((page: IPageForPageDuplicateModal) => {
    openDuplicateModal(page, {
      onDuplicated: () => {
        // Notify headless-tree update
        const parentId = item.parent != null ? getIdStringForRef(item.parent) : ROOT_PAGE_VIRTUAL_ID;
        notifyUpdateItems([parentId]);
      },
    });
  }, [openDuplicateModal, notifyUpdateItems, item.parent]);

  const onClickDeleteMenuItem = useCallback((page: IPageToDeleteWithMeta) => {
    openDeleteModal([page], {
      onDeleted: () => {
        // Notify headless-tree update
        const parentId = item.parent != null ? getIdStringForRef(item.parent) : ROOT_PAGE_VIRTUAL_ID;
        notifyUpdateItems([parentId]);
      },
    });
  }, [openDeleteModal, item.parent, notifyUpdateItems]);

  const { Control } = usePageItemControl();

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
      itemLevel={itemLevel}
      targetPath={targetPath}
      targetPathOrId={targetPathOrId ?? undefined}
      isExpanded={isExpanded}
      isWipPageShown={isWipPageShown}
      isEnableActions={isEnableActions}
      isReadOnlyUser={isReadOnlyUser}
      isRenaming={isRenaming}
      renameInputProps={renameInputProps}
      onClick={itemSelectedHandler}
      onWheelClick={itemSelectedByWheelClickHandler}
      onToggle={onToggle}
      onClickDuplicateMenuItem={onClickDuplicateMenuItem}
      onClickDeleteMenuItem={onClickDeleteMenuItem}
      onStartCreatePage={onStartCreatePage}
      customEndComponents={[CountBadgeForPageTreeItem]}
      customHoveredEndComponents={[Control, NewPageCreateButton]}
    />
  );
};
