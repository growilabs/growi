import { useEffect, useRef } from 'react';
import { addTrailingSlash } from '@growi/core/dist/utils/path-utils';
import type { ItemInstance } from '@headless-tree/core';

import type { IPageForTreeItem } from '~/interfaces/page';

type UseAutoExpandAncestorsProps = {
  items: ItemInstance<IPageForTreeItem>[];
  targetPath: string;
  onExpanded?: () => void;
};

/**
 * Get all ancestor paths for a given target path
 * e.g., "/Sandbox/Diagrams/figure-1" => ["/Sandbox", "/Sandbox/Diagrams"]
 */
export const getAncestorPaths = (targetPath: string): string[] => {
  const segments = targetPath.split('/').filter(Boolean);
  const ancestors: string[] = [];

  // Build ancestor paths (excluding the target itself)
  for (let i = 0; i < segments.length - 1; i++) {
    ancestors.push(`/${segments.slice(0, i + 1).join('/')}`);
  }

  return ancestors;
};

/**
 * Check if itemPath is an ancestor of targetPath
 */
export const isAncestorOf = (itemPath: string, targetPath: string): boolean => {
  if (itemPath === '/') {
    return targetPath !== '/';
  }
  return (
    targetPath.startsWith(addTrailingSlash(itemPath)) && targetPath !== itemPath
  );
};

/**
 * Hook to auto-expand tree items that are ancestors of the target path.
 * This is useful for revealing a deeply nested page in a tree view.
 *
 * The hook handles async data loading by:
 * 1. Expanding ancestors as they become available in items
 * 2. Waiting for all ancestor paths to be loaded before marking as complete
 * 3. Re-running when items change (e.g., after children are loaded)
 */
export const useAutoExpandAncestors = ({
  items,
  targetPath,
  onExpanded,
}: UseAutoExpandAncestorsProps): void => {
  const processedTargetPathRef = useRef<string | null>(null);

  useEffect(() => {
    // Skip if no items loaded yet
    if (items.length === 0) {
      return;
    }

    // Skip if already fully processed for this targetPath
    if (processedTargetPathRef.current === targetPath) {
      return;
    }

    let didExpand = false;

    for (const item of items) {
      const itemData = item.getItemData();
      const itemPath = itemData.path;

      if (itemPath == null) continue;

      // Check if this item is an ancestor of targetPath (including root "/")
      const isAncestorOfTarget =
        itemPath === '/' || isAncestorOf(itemPath, targetPath);

      if (!isAncestorOfTarget) continue;

      const isFolder = item.isFolder();
      const isExpanded = item.isExpanded();

      if (isFolder && !isExpanded) {
        item.expand();
        didExpand = true;
      }
    }

    // If we expanded any items, trigger callback to re-render and load children
    if (didExpand) {
      onExpanded?.();
    } else {
      // Only mark as fully processed when all ancestors are expanded
      // Check if we have all the ancestors we need
      const ancestorPaths = getAncestorPaths(targetPath);
      const hasAllAncestors = ancestorPaths.every((ancestorPath) =>
        items.some((item) => item.getItemData().path === ancestorPath),
      );

      if (hasAllAncestors) {
        processedTargetPathRef.current = targetPath;
      }
    }
  }, [items, targetPath, onExpanded]);
};
