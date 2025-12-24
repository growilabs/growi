import { useCallback } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';

import type { IPageForTreeItem } from '~/interfaces/page';

import { CREATING_PAGE_VIRTUAL_ID } from '../../constants/_inner';

/**
 * Create a placeholder page data for the creating node
 */
export const createPlaceholderPageData = (
  parentId: string,
  parentPath: string,
): IPageForTreeItem => ({
  _id: CREATING_PAGE_VIRTUAL_ID,
  path: `${parentPath === '/' ? '' : parentPath}/`,
  parent: parentId,
  descendantCount: 0,
  grant: 1,
  isEmpty: true,
  wip: false,
});

/**
 * State for managing page creation in the tree
 * Stores the parent page info where a new page is being created
 */
type CreatingParentInfo = {
  id: string;
  path: string;
} | null;

const creatingParentInfoAtom = atom<CreatingParentInfo>(null);

// Module-level flag for synchronous guard against rapid clicks
// This is shared across all hook instances
let isCreatingFlag = false;

/**
 * Reset the creating flag (for testing purposes only)
 * @internal
 */
export const resetCreatingFlagForTesting = (): void => {
  isCreatingFlag = false;
};

/**
 * Hook to get the current creating parent ID
 */
export const useCreatingParentId = (): string | null => {
  const info = useAtomValue(creatingParentInfoAtom);
  return info?.id ?? null;
};

/**
 * Hook to get the current creating parent path
 */
export const useCreatingParentPath = (): string | null => {
  const info = useAtomValue(creatingParentInfoAtom);
  return info?.path ?? null;
};

/**
 * Hook to check if a specific item is in "creating child" mode
 */
export const useIsCreatingChild = (parentId: string | undefined): boolean => {
  const creatingParentId = useCreatingParentId();
  return parentId != null && creatingParentId === parentId;
};

type PageTreeCreateActions = {
  /**
   * Start creating a new page under the specified parent
   */
  startCreating: (parentId: string, parentPath: string) => void;
  /**
   * Cancel the current page creation
   */
  cancelCreating: () => void;
};

/**
 * Hook to get page tree create actions
 */
export const usePageTreeCreateActions = (): PageTreeCreateActions => {
  const setCreatingParentInfo = useSetAtom(creatingParentInfoAtom);

  const startCreating = useCallback(
    (parentId: string, parentPath: string) => {
      // Synchronous check to prevent rapid clicks
      // Uses module-level flag shared across all hook instances
      if (isCreatingFlag) {
        return;
      }
      isCreatingFlag = true;
      setCreatingParentInfo({ id: parentId, path: parentPath });
    },
    [setCreatingParentInfo],
  );

  const cancelCreating = useCallback(() => {
    isCreatingFlag = false;
    setCreatingParentInfo(null);
  }, [setCreatingParentInfo]);

  return { startCreating, cancelCreating };
};
