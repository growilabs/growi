import type { FC } from 'react';
import { useCallback, useEffect, useMemo } from 'react';
import { useTree } from '@headless-tree/react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'next-i18next';

import { toastError, toastWarning } from '~/client/util/toastr';
import type { IPageForTreeItem } from '~/interfaces/page';
import { useSWRxRootPage } from '~/stores/page-listing';

import { ROOT_PAGE_VIRTUAL_ID } from '../constants/_inner';
import {
  useAutoExpandAncestors,
  useDataLoader,
  useExpandParentOnCreate,
  useScrollToSelectedItem,
  useTreeFeatures,
  useTreeItemHandlers,
  useTreeRevalidation,
} from '../hooks/_inner';
import { useSocketUpdateDescCount } from '../hooks/use-socket-update-desc-count';
import type { TreeItemProps } from '../interfaces';
import { useTriggerTreeRebuild } from '../states/_inner';

// Stable createLoadingItemData function
const createLoadingItemData = (): IPageForTreeItem => ({
  _id: '',
  path: 'Loading...',
  parent: '',
  descendantCount: 0,
  grant: 1,
  isEmpty: false,
  wip: false,
});

type Props = {
  targetPath: string;
  targetPathOrId?: string;
  isWipPageShown?: boolean;
  isEnableActions?: boolean;
  isReadOnlyUser?: boolean;
  CustomTreeItem: React.FunctionComponent<TreeItemProps>;
  estimateTreeItemSize: () => number;
  scrollerElem?: HTMLElement | null;
  // Feature options
  enableRenaming?: boolean;
  enableCheckboxes?: boolean;
  enableDragAndDrop?: boolean;
  initialCheckedItems?: string[];
  onCheckedItemsChange?: (checkedItems: IPageForTreeItem[]) => void;
};

export const ItemsTree: FC<Props> = (props: Props) => {
  const {
    targetPath,
    targetPathOrId,
    isWipPageShown = true,
    isEnableActions = false,
    isReadOnlyUser = false,
    CustomTreeItem,
    estimateTreeItemSize,
    scrollerElem,
    enableRenaming = false,
    enableCheckboxes = false,
    enableDragAndDrop = false,
    initialCheckedItems = [],
    onCheckedItemsChange,
  } = props;

  const { t } = useTranslation();
  const triggerTreeRebuild = useTriggerTreeRebuild();

  const { data: rootPageResult } = useSWRxRootPage({ suspense: true });
  const rootPage = rootPageResult?.rootPage;
  const rootPageId = rootPage?._id ?? ROOT_PAGE_VIRTUAL_ID;
  const allPagesCount = rootPage?.descendantCount ?? 0;

  const dataLoader = useDataLoader(rootPageId, allPagesCount);

  // Tree item handlers (rename, create, etc.) with stable callbacks for headless-tree
  const { getItemName, isItemFolder, handleRename, creatingParentId } =
    useTreeItemHandlers(triggerTreeRebuild);

  // Configure tree features and get checkbox state and D&D handlers
  const { features, checkboxProperties, dndProperties } = useTreeFeatures({
    enableRenaming,
    enableCheckboxes,
    enableDragAndDrop,
    initialCheckedItems,
  });

  const { setCheckedItems, createNotifyEffect } = checkboxProperties;
  const { canDrag, canDrop, onDrop, renderDragLine } = dndProperties;

  // Wrap onDrop to show toast notifications
  const handleDrop = useCallback(
    async (...args: Parameters<typeof onDrop>) => {
      const result = await onDrop(...args);
      if (!result.success) {
        if (result.errorType === 'operation_blocked') {
          toastWarning(t('page_tree.move_blocked'));
        } else {
          toastError(t('page_tree.move_failed'));
        }
      }
    },
    [onDrop, t],
  );

  // Stable initial state
  // biome-ignore lint/correctness/useExhaustiveDependencies: initialCheckedItems is intentionally not in deps to avoid reinitializing on every change
  const initialState = useMemo(
    () => ({
      expandedItems: [ROOT_PAGE_VIRTUAL_ID],
      ...(enableCheckboxes ? { checkedItems: initialCheckedItems } : {}),
    }),
    [enableCheckboxes],
  );

  const tree = useTree<IPageForTreeItem>({
    rootItemId: ROOT_PAGE_VIRTUAL_ID,
    getItemName,
    initialState,
    isItemFolder,
    createLoadingItemData,
    dataLoader,
    onRename: handleRename,
    features,
    // Checkbox configuration
    canCheckFolders: enableCheckboxes,
    propagateCheckedState: false,
    setCheckedItems,
    // Drag and drop configuration (only when enabled)
    ...(enableDragAndDrop && {
      canDrag,
      canDrop,
      onDrop: handleDrop,
      canDropInbetween: false,
    }),
  });

  // Notify parent when checked items change
  // biome-ignore lint/correctness/useExhaustiveDependencies: createNotifyEffect already includes checkedItemIds in its closure
  useEffect(createNotifyEffect(tree, onCheckedItemsChange), [
    createNotifyEffect,
    tree,
  ]);

  // Subscribe to Socket.io UpdateDescCount events
  useSocketUpdateDescCount();

  // Handle tree revalidation and items count tracking
  useTreeRevalidation({ tree, triggerTreeRebuild });

  // Expand parent item when page creation is initiated
  useExpandParentOnCreate({
    tree,
    creatingParentId,
    onTreeUpdated: triggerTreeRebuild,
  });

  const items = tree.getItems();

  // Auto-expand items that are ancestors of targetPath
  useAutoExpandAncestors({
    items,
    targetPath,
    onExpanded: triggerTreeRebuild,
  });

  const getScrollElement = useCallback(
    () => scrollerElem ?? null,
    [scrollerElem],
  );

  const stableEstimateSize = useCallback(() => {
    return estimateTreeItemSize();
  }, [estimateTreeItemSize]);

  const measureElement = useCallback(
    (element: Element | null) => {
      // Return consistent height measurement
      return element?.getBoundingClientRect().height ?? stableEstimateSize();
    },
    [stableEstimateSize],
  );

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement,
    estimateSize: stableEstimateSize,
    overscan: 5,
    measureElement,
  });

  // Scroll to selected item on mount or when targetPathOrId changes
  useScrollToSelectedItem({ targetPathOrId, items, virtualizer });

  return (
    <div
      {...tree.getContainerProps()}
      className="list-group position-relative"
      style={{ height: `${virtualizer.getTotalSize()}px` }}
    >
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

        const { ref: itemRef, ...itemProps } = item.getProps();
        // Exclude onClick from itemProps to prevent conflicts
        const { onClick: _onClick, ...itemPropsWithoutOnClick } = itemProps;

        return (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`,
            }}
            ref={(node) => {
              if (node && itemRef) {
                (itemRef as (node: HTMLElement) => void)(node);
              }
            }}
            // Apply props
            {...itemPropsWithoutOnClick}
          >
            <CustomTreeItem
              item={item}
              targetPath={targetPath}
              targetPathOrId={targetPathOrId}
              isWipPageShown={isWipPageShown}
              isEnableActions={isEnableActions}
              isReadOnlyUser={isReadOnlyUser}
              onToggle={triggerTreeRebuild}
            />
          </div>
        );
      })}
      {/* Drag line indicator (rendered by dndProperties when D&D is enabled) */}
      {renderDragLine(tree)}
    </div>
  );
};
