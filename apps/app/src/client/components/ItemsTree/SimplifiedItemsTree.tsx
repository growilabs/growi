import type { FC } from 'react';
import { useState, useCallback } from 'react';

import { asyncDataLoaderFeature, renameFeature } from '@headless-tree/core';
import { useTree } from '@headless-tree/react';
import { useVirtualizer } from '@tanstack/react-virtual';
import nodePath from 'path';

import { Origin } from '@growi/core';
import { pathUtils, pagePathUtils } from '@growi/core/dist/utils';
import { useTranslation } from 'next-i18next';

import { useCreatePage } from '~/client/services/create-page';
import { toastSuccess, toastWarning, toastError } from '~/client/util/toastr';
import { ROOT_PAGE_VIRTUAL_ID } from '~/constants/page-tree';
import type { IPageForTreeItem } from '~/interfaces/page';
import { usePageTreeInformationGeneration, usePageTreeRevalidationEffect, usePageTreeInformationUpdate } from '~/states/page-tree-update';
import { useSWRxRootPage } from '~/stores/page-listing';
import { shouldCreateWipPage } from '~/utils/should-create-wip-page';

import type { TreeItemProps } from '../TreeItem';

import { usePageTreeDataLoader, isTempPageId, createTempPageId } from './hooks/usePageTreeDataLoader';
import { useScrollToSelectedItem } from './hooks/useScrollToSelectedItem';

type Props = {
  targetPath: string;
  targetPathOrId?: string;
  isWipPageShown?: boolean;
  isEnableActions?: boolean;
  isReadOnlyUser?: boolean;
  CustomTreeItem: React.FunctionComponent<TreeItemProps>
  estimateTreeItemSize: () => number;
  scrollerElem?: HTMLElement | null;
  onStartCreatePage?: (parentId: string, parentPath: string) => void;
};

export const SimplifiedItemsTree: FC<Props> = (props: Props) => {
  const {
    targetPath, targetPathOrId,
    isWipPageShown = true, isEnableActions = false, isReadOnlyUser = false,
    CustomTreeItem, estimateTreeItemSize,
    scrollerElem,
    onStartCreatePage,
  } = props;

  const { t } = useTranslation();
  const { create: createPage } = useCreatePage();
  const { notifyUpdateItems } = usePageTreeInformationUpdate();

  const [, setRebuildTrigger] = useState(0);

  const { data: rootPageResult } = useSWRxRootPage({ suspense: true });
  const rootPage = rootPageResult?.rootPage;
  const rootPageId = rootPage?._id ?? ROOT_PAGE_VIRTUAL_ID;
  const allPagesCount = rootPage?.descendantCount ?? 0;

  const { dataLoader, addTempPage, removeTempPage, getTempPageData } = usePageTreeDataLoader(rootPageId, allPagesCount);

  // Handle rename callback for page creation
  const handleRename = useCallback(async (item: any, newName: string) => {
    const itemData = item.getItemData();
    const itemId = itemData._id;

    // Check if this is a temporary page being created
    if (!isTempPageId(itemId)) {
      // This is a regular rename operation - not handled here yet
      return;
    }

    const tempData = getTempPageData(itemId);
    if (!tempData) {
      console.error('Temp page data not found for:', itemId);
      return;
    }

    // Validate the name
    if (!newName || newName.trim() === '') {
      // Cancel creation - remove temp page
      removeTempPage(itemId);
      tree.rebuildTree();
      return;
    }

    const parentPath = pathUtils.addTrailingSlash(tempData.parentPath);
    const newPagePath = nodePath.resolve(parentPath, newName);
    const isCreatable = pagePathUtils.isCreatablePage(newPagePath);

    if (!isCreatable) {
      toastWarning(t('you_can_not_create_page_with_this_name_or_hierarchy'));
      // Remove the temp page and rebuild
      removeTempPage(itemId);
      tree.rebuildTree();
      return;
    }

    try {
      // Create the actual page
      await createPage(
        {
          path: newPagePath,
          parentPath,
          body: undefined,
          grant: undefined,
          grantUserGroupIds: undefined,
          origin: Origin.View,
          wip: shouldCreateWipPage(newPagePath),
        },
        {
          skipTransition: true,
          onCreated: () => {
            // Remove temp page
            removeTempPage(itemId);
            
            // Notify headless-tree to update children
            notifyUpdateItems([tempData.parentId]);
            
            toastSuccess(t('successfully_saved_the_page'));
          },
        },
      );
    }
    catch (err) {
      toastError(err);
      // Remove temp page on error
      removeTempPage(itemId);
      tree.rebuildTree();
    }
  }, [t, createPage, notifyUpdateItems, getTempPageData, removeTempPage]);

  const handleAbortRename = useCallback((item: any) => {
    const itemData = item.getItemData();
    const itemId = itemData._id;

    // If this is a temp page, remove it
    if (isTempPageId(itemId)) {
      removeTempPage(itemId);
      tree.rebuildTree();
    }
  }, [removeTempPage]);

  const tree = useTree<IPageForTreeItem>({
    rootItemId: ROOT_PAGE_VIRTUAL_ID,
    getItemName: item => {
      const data = item.getItemData();
      // For temp pages, show placeholder
      if (isTempPageId(data._id)) {
        return '';
      }
      return data.path || '/';
    },
    initialState: { expandedItems: [ROOT_PAGE_VIRTUAL_ID] },
    isItemFolder: item => item.getItemData().descendantCount > 0,
    createLoadingItemData: () => ({
      _id: '',
      path: 'Loading...',
      parent: '',
      descendantCount: 0,
      revision: '',
      grant: 1,
      isEmpty: false,
      wip: false,
    }),
    dataLoader,
    onRename: handleRename,
    onAbortRename: handleAbortRename,
    features: [asyncDataLoaderFeature, renameFeature],
  });

  // Function to start creating a new page
  const startCreatingPage = useCallback((parentId: string, parentPath: string) => {
    const tempId = createTempPageId();
    addTempPage(tempId, parentId, parentPath);
    
    // Expand parent if not expanded
    const parentItem = tree.getItemInstance(parentId);
    if (!parentItem.isExpanded()) {
      parentItem.expand();
    }

    // Trigger tree rebuild
    tree.rebuildTree();

    // Wait for render, then start renaming
    setTimeout(() => {
      try {
        const tempItem = tree.getItemInstance(tempId);
        tempItem.startRenaming();
      }
      catch (error) {
        console.error('Failed to start renaming temp page:', error);
        removeTempPage(tempId);
        tree.rebuildTree();
      }
    }, 100);
  }, [tree, addTempPage, removeTempPage]);

  // Expose startCreatingPage via prop callback
  if (onStartCreatePage) {
    // This is a workaround to pass the function up
    // In practice, we should use Context or pass tree instance
    (window as any).__startCreatingPage = startCreatingPage;
  }

  // Track local generation number
  const [localGeneration, setLocalGeneration] = useState(1);
  const globalGeneration = usePageTreeInformationGeneration();

  // Refetch data when global generation is updated
  usePageTreeRevalidationEffect(tree, localGeneration, {
    // Update local generation number after revalidation
    onRevalidated: () => setLocalGeneration(globalGeneration),
  });

  const items = tree.getItems();

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollerElem ?? null,
    estimateSize: estimateTreeItemSize,
    overscan: 5,
  });

  // Scroll to selected item on mount or when targetPathOrId changes
  useScrollToSelectedItem({ targetPathOrId, items, virtualizer });

  return (
    <div className="list-group">
      {virtualizer.getVirtualItems().map((virtualItem) => {
        const item = items[virtualItem.index];
        const itemData = item.getItemData();

        // Skip rendering virtual root
        if (itemData._id === ROOT_PAGE_VIRTUAL_ID) {
          return null;
        }

        // Skip rendering WIP pages if not shown
        if (!isWipPageShown && itemData.wip) {
          return null;
        }

        const props = item.getProps();

        return (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={(node) => {
              virtualizer.measureElement(node);
              if (node && props.ref) {
                (props.ref as (node: HTMLElement) => void)(node);
              }
            }}
          >
            <CustomTreeItem
              item={itemData}
              itemLevel={item.getItemMeta().level}
              isExpanded={item.isExpanded()}
              targetPath={targetPath}
              targetPathOrId={targetPathOrId}
              isWipPageShown={isWipPageShown}
              isEnableActions={isEnableActions}
              isReadOnlyUser={isReadOnlyUser}
              isRenaming={item.isRenaming ? item.isRenaming() : false}
              renameInputProps={item.getRenameInputProps ? item.getRenameInputProps() : undefined}
              onStartCreatePage={startCreatingPage}
              onToggle={() => {
                if (item.isExpanded()) {
                  item.collapse();
                }
                else {
                  item.expand();
                }
                // Trigger re-render to show/hide children
                setRebuildTrigger(prev => prev + 1);
              }}
            />
          </div>
        );
      })}
    </div>
  );
};
