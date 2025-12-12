import { useCallback, useRef } from 'react';
import type { ItemInstance, TreeConfig } from '@headless-tree/core';

import type { IPageForTreeItem } from '~/interfaces/page';

import { useCreatingParentId } from '../../states/_inner';
import { usePageCreate } from '../use-page-create';
import { usePageRename } from '../use-page-rename';

type UseTreeItemHandlersReturn = {
  /**
   * Stable callback for headless-tree getItemName config
   */
  getItemName: TreeConfig<IPageForTreeItem>['getItemName'];

  /**
   * Stable callback for headless-tree isItemFolder config
   */
  isItemFolder: TreeConfig<IPageForTreeItem>['isItemFolder'];

  /**
   * Stable callback for headless-tree onRename config
   * Handles both rename and create (for placeholder nodes)
   */
  handleRename: TreeConfig<IPageForTreeItem>['onRename'];

  /**
   * Current creating parent ID (for tree expansion logic)
   */
  creatingParentId: string | null;
};

/**
 * Hook that provides stable callbacks for headless-tree configuration.
 *
 * This hook consolidates the integration between page create/rename logic
 * and headless-tree's useTree configuration. It uses refs to access the latest
 * state values inside callbacks while keeping the callback references stable.
 *
 * @param onAfterRename - Optional callback to trigger after rename/create operation
 */
export const useTreeItemHandlers = (
  onAfterRename?: () => void,
): UseTreeItemHandlersReturn => {
  // Page rename hook
  const { rename, getPageName } = usePageRename();

  // Page create hook
  const { createFromPlaceholder, isCreatingPlaceholder, cancelCreating } =
    usePageCreate();

  // Get creating parent id for React re-renders (used in return value and ref)
  const creatingParentId = useCreatingParentId();

  // Use refs to stabilize callbacks passed to headless-tree
  // This prevents headless-tree from detecting config changes and refetching data
  const creatingParentIdRef = useRef(creatingParentId);
  creatingParentIdRef.current = creatingParentId;

  const getPageNameRef = useRef(getPageName);
  getPageNameRef.current = getPageName;

  const renameRef = useRef(rename);
  renameRef.current = rename;

  const createFromPlaceholderRef = useRef(createFromPlaceholder);
  createFromPlaceholderRef.current = createFromPlaceholder;

  const isCreatingPlaceholderRef = useRef(isCreatingPlaceholder);
  isCreatingPlaceholderRef.current = isCreatingPlaceholder;

  const cancelCreatingRef = useRef(cancelCreating);
  cancelCreatingRef.current = cancelCreating;

  const onAfterRenameRef = useRef(onAfterRename);
  onAfterRenameRef.current = onAfterRename;

  // Stable getItemName callback - receives ItemInstance from headless-tree
  const getItemName = useCallback((item: ItemInstance<IPageForTreeItem>) => {
    return getPageNameRef.current(item);
  }, []);

  // Stable isItemFolder callback
  // IMPORTANT: Do NOT call item.getChildren() here as it triggers API calls for ALL visible items
  const isItemFolder = useCallback((item: ItemInstance<IPageForTreeItem>) => {
    const itemData = item.getItemData();
    // Read from ref to get current value without triggering callback recreation
    const currentCreatingParentId = creatingParentIdRef.current;
    const isCreatingUnderThis = currentCreatingParentId === itemData._id;
    if (isCreatingUnderThis) return true;

    // Use descendantCount from the item data to determine if it's a folder
    // This avoids triggering getChildrenWithData API calls
    return itemData.descendantCount > 0;
  }, []);

  // Stable onRename handler for headless-tree
  // Handles both rename and create (for placeholder nodes)
  const handleRename = useCallback(
    async (item: ItemInstance<IPageForTreeItem>, newValue: string) => {
      if (isCreatingPlaceholderRef.current(item)) {
        // Placeholder node: create new page or cancel if empty
        if (newValue.trim() === '') {
          // Empty value means cancel (Esc key or blur)
          cancelCreatingRef.current();
        } else {
          await createFromPlaceholderRef.current(item, newValue);
        }
      } else {
        // Normal node: rename page
        await renameRef.current(item, newValue);
      }
      // Trigger callback after operation
      onAfterRenameRef.current?.();
    },
    [],
  );

  return {
    getItemName,
    isItemFolder,
    handleRename,
    creatingParentId,
  };
};
