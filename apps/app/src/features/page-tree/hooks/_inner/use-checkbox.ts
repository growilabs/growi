import { useCallback, useMemo, useState } from 'react';

import type { IPageForTreeItem } from '~/interfaces/page';

type TreeInstance = {
  getItemInstance: (
    id: string,
  ) => { getItemData: () => IPageForTreeItem } | undefined;
};

export type UseCheckboxOptions = {
  enabled: boolean;
  initialCheckedItems: string[];
};

export type UseCheckboxProperties = {
  checkedItemIds: string[];
  setCheckedItems: ((itemIds: string[]) => void) | undefined;
  /**
   * Helper to create a useEffect callback for notifying parent of checked items changes.
   * Usage in component:
   * ```
   * useEffect(
   *   checkboxProperties.createNotifyEffect(tree, onCheckedItemsChange),
   *   [checkboxProperties.checkedItemIds, tree, onCheckedItemsChange]
   * );
   * ```
   */
  createNotifyEffect: (
    tree: TreeInstance,
    onCheckedItemsChange?: (checkedItems: IPageForTreeItem[]) => void,
  ) => () => void;
};

/**
 * Hook to manage checkbox state for headless-tree.
 * Provides state tracking and setter callback for checked items.
 */
export const useCheckbox = (
  options: UseCheckboxOptions,
): UseCheckboxProperties => {
  const { enabled, initialCheckedItems } = options;

  // State to track checked items for re-rendering
  const [checkedItemIds, setCheckedItemIds] =
    useState<string[]>(initialCheckedItems);

  // Callback to update checked items state (triggers re-render)
  const handleSetCheckedItems = useCallback((itemIds: string[]) => {
    setCheckedItemIds(itemIds);
  }, []);

  // Helper to create useEffect callback for notifying parent
  const createNotifyEffect = useCallback(
    (
      tree: TreeInstance,
      onCheckedItemsChange?: (checkedItems: IPageForTreeItem[]) => void,
    ) => {
      return () => {
        if (!enabled || onCheckedItemsChange == null) {
          return;
        }

        const checkedPages = checkedItemIds
          .map((id) => tree.getItemInstance(id)?.getItemData())
          .filter((page): page is IPageForTreeItem => page != null);
        onCheckedItemsChange(checkedPages);
      };
    },
    [enabled, checkedItemIds],
  );

  return useMemo(
    () => ({
      checkedItemIds,
      setCheckedItems: enabled ? handleSetCheckedItems : undefined,
      createNotifyEffect,
    }),
    [checkedItemIds, enabled, handleSetCheckedItems, createNotifyEffect],
  );
};
