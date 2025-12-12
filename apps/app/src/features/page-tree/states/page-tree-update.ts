import { useCallback, useEffect, useRef } from 'react';
import type { TreeInstance } from '@headless-tree/core';
import { atom, useAtomValue, useSetAtom } from 'jotai';

import { ROOT_PAGE_VIRTUAL_ID } from '../constants/_inner';
import { invalidatePageTreeChildren } from '../services';

// Update generation number
const generationAtom = atom<number>(1);

// Array of IDs for last updated items
// null is a special value meaning full tree update
const lastUpdatedItemIdsAtom = atom<string[] | null>(null);

// Read-only hooks
export const usePageTreeInformationGeneration = () =>
  useAtomValue(generationAtom);

export const usePageTreeInformationLastUpdatedItemIds = () =>
  useAtomValue(lastUpdatedItemIdsAtom);

// Hook for notifying tree updates
export const usePageTreeInformationUpdate = () => {
  const setGeneration = useSetAtom(generationAtom);
  const setLastUpdatedIds = useSetAtom(lastUpdatedItemIdsAtom);

  // Notify update for specific items
  const notifyUpdateItems = useCallback(
    (itemIds?: string[]) => {
      setLastUpdatedIds(itemIds ?? [ROOT_PAGE_VIRTUAL_ID]);
      setGeneration((prev) => prev + 1);
    },
    [setGeneration, setLastUpdatedIds],
  );

  // Notify update for all trees
  const notifyUpdateAllTrees = useCallback(() => {
    setLastUpdatedIds(null);
    setGeneration((prev) => prev + 1);
  }, [setGeneration, setLastUpdatedIds]);

  return {
    notifyUpdateItems,
    notifyUpdateAllTrees,
  };
};

export const usePageTreeRevalidationEffect = (
  tree: TreeInstance<unknown>,
  generation: number,
  opts?: { onRevalidated?: () => void },
) => {
  const globalGeneration = useAtomValue(generationAtom);
  const globalLastUpdatedItemIds = useAtomValue(lastUpdatedItemIdsAtom);

  const { getItemInstance } = tree;

  // Use ref to avoid opts causing infinite loop in dependency array
  const onRevalidatedRef = useRef(opts?.onRevalidated);
  onRevalidatedRef.current = opts?.onRevalidated;

  useEffect(() => {
    if (globalGeneration <= generation) {
      return;
    }

    const shouldUpdateAll = globalLastUpdatedItemIds == null;

    if (shouldUpdateAll) {
      // Full tree update: clear all pending requests
      invalidatePageTreeChildren();

      // Only invalidate expanded items (they are the ones with visible children)
      // Using optimistic=true to avoid multiple rebuildTree calls and loading states
      const expandedItems = tree.getItems().filter((item) => item.isExpanded());
      expandedItems.forEach((item) => {
        item.invalidateChildrenIds(true);
      });

      // Also invalidate root to refresh top-level
      getItemInstance(ROOT_PAGE_VIRTUAL_ID)?.invalidateChildrenIds(false);
    } else {
      // Partial update: only invalidate specified items
      invalidatePageTreeChildren(globalLastUpdatedItemIds);
      globalLastUpdatedItemIds.forEach((itemId) => {
        getItemInstance(itemId)?.invalidateChildrenIds(false);
      });
    }

    onRevalidatedRef.current?.();
  }, [
    globalGeneration,
    generation,
    getItemInstance,
    globalLastUpdatedItemIds,
    tree,
  ]);
};
