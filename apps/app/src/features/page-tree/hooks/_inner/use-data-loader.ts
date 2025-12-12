import { useMemo, useRef } from 'react';
import type { TreeDataLoader } from '@headless-tree/core';

import { apiv3Get } from '~/client/util/apiv3-client';
import type { IPageForTreeItem } from '~/interfaces/page';

import {
  CREATING_PAGE_VIRTUAL_ID,
  ROOT_PAGE_VIRTUAL_ID,
} from '../../constants/_inner';
import { type ChildrenData, fetchAndCacheChildren } from '../../services';
import {
  createPlaceholderPageData,
  useCreatingParentId,
  useCreatingParentPath,
} from '../../states/_inner';

function constructRootPageForVirtualRoot(
  rootPageId: string,
  allPagesCount: number,
): IPageForTreeItem {
  return {
    _id: rootPageId,
    path: '/',
    parent: null,
    descendantCount: allPagesCount,
    grant: 1,
    isEmpty: false,
    wip: false,
  };
}

export const useDataLoader = (
  rootPageId: string,
  allPagesCount: number,
): TreeDataLoader<IPageForTreeItem> => {
  const creatingParentId = useCreatingParentId();
  const creatingParentPath = useCreatingParentPath();

  // Use refs to avoid recreating dataLoader callbacks when creating state changes
  // The creating state is accessed via refs so that:
  // 1. The dataLoader reference stays stable (prevents headless-tree from refetching all data)
  // 2. The actual creating state is still read at execution time (when invalidateChildrenIds is called)
  const creatingParentIdRef = useRef(creatingParentId);
  const creatingParentPathRef = useRef(creatingParentPath);
  creatingParentIdRef.current = creatingParentId;
  creatingParentPathRef.current = creatingParentPath;

  // Memoize the entire dataLoader object to ensure reference stability
  // Only recreate when rootPageId or allPagesCount changes (which are truly needed for the API calls)
  // Note: Creating state is read from refs inside callbacks to avoid triggering dataLoader recreation
  const dataLoader = useMemo<TreeDataLoader<IPageForTreeItem>>(() => {
    const getItem = async (itemId: string): Promise<IPageForTreeItem> => {
      // Virtual root (should rarely be called since it's provided by getChildrenWithData)
      if (itemId === ROOT_PAGE_VIRTUAL_ID) {
        return constructRootPageForVirtualRoot(rootPageId, allPagesCount);
      }

      // Creating placeholder node - return placeholder data
      if (itemId === CREATING_PAGE_VIRTUAL_ID) {
        // This shouldn't normally be called, but return empty placeholder if it is
        return createPlaceholderPageData('', '/');
      }

      // For all pages (including root), use /page-listing/item endpoint
      // Note: This should rarely be called thanks to getChildrenWithData caching
      const response = await apiv3Get<{ item: IPageForTreeItem }>(
        '/page-listing/item',
        { id: itemId },
      );
      return response.data.item;
    };

    const getChildrenWithData = async (
      itemId: string,
    ): Promise<ChildrenData> => {
      // Virtual root returns root page as its only child
      // Use actual MongoDB _id as tree item ID to avoid duplicate API calls
      if (itemId === ROOT_PAGE_VIRTUAL_ID) {
        return [
          {
            id: rootPageId,
            data: constructRootPageForVirtualRoot(rootPageId, allPagesCount),
          },
        ];
      }

      // Placeholder node has no children
      if (itemId === CREATING_PAGE_VIRTUAL_ID) {
        return [];
      }

      const children = await fetchAndCacheChildren(itemId);

      // If this parent is in "creating" mode, prepend placeholder node
      // Read from refs to get current value without triggering dataLoader recreation
      const currentCreatingParentId = creatingParentIdRef.current;
      const currentCreatingParentPath = creatingParentPathRef.current;
      if (
        currentCreatingParentId === itemId &&
        currentCreatingParentPath != null
      ) {
        const placeholderData = createPlaceholderPageData(
          itemId,
          currentCreatingParentPath,
        );
        return [
          { id: CREATING_PAGE_VIRTUAL_ID, data: placeholderData },
          ...children,
        ];
      }

      return children;
    };

    return { getItem, getChildrenWithData };
  }, [allPagesCount, rootPageId]);

  return dataLoader;
};
