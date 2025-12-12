import { useEffect, useRef } from 'react';
import type { TreeInstance } from '@headless-tree/core';

import type { IPageForTreeItem } from '~/interfaces/page';

import { invalidatePageTreeChildren } from '../../services';

type UseExpandParentOnCreateParams = {
  tree: TreeInstance<IPageForTreeItem>;
  creatingParentId: string | null;
  onTreeUpdated?: () => void;
};

/**
 * Hook that expands the parent item when page creation is initiated.
 *
 * When a new page creation is initiated (creatingParentId is set),
 * this hook:
 * 1. Rebuilds the tree to re-evaluate isItemFolder
 * 2. Expands the parent item if not already expanded
 * 3. Invalidates children cache to load placeholder
 * 4. Triggers a re-render via onTreeUpdated callback
 *
 * IMPORTANT: This hook uses a ref-based approach to track changes
 * instead of a dependency array. This prevents infinite loops that
 * would occur because the tree object changes on every render.
 */
export const useExpandParentOnCreate = ({
  tree,
  creatingParentId,
  onTreeUpdated,
}: UseExpandParentOnCreateParams): void => {
  // Track previous creatingParentId to detect changes
  const prevCreatingParentIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Only run when creatingParentId actually changes (not on every render)
    if (creatingParentId === prevCreatingParentIdRef.current) return;
    prevCreatingParentIdRef.current = creatingParentId;

    if (creatingParentId == null) return;

    // Rebuild tree first to re-evaluate isItemFolder
    tree.rebuildTree();

    // Then expand the parent item
    const parentItem = tree.getItemInstance(creatingParentId);
    if (parentItem != null && !parentItem.isExpanded()) {
      parentItem.expand();
    }

    // Clear cache for this parent and invalidate children to load placeholder
    invalidatePageTreeChildren([creatingParentId]);
    parentItem?.invalidateChildrenIds(true);

    // Trigger re-render
    onTreeUpdated?.();
  });
};
