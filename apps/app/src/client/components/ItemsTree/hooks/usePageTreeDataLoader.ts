import { useCallback, useRef } from 'react';

import type { TreeDataLoader } from '@headless-tree/core';

import { apiv3Get } from '~/client/util/apiv3-client';
import { ROOT_PAGE_VIRTUAL_ID } from '~/constants/page-tree';
import type { IPageForTreeItem } from '~/interfaces/page';

function constructRootPageForVirtualRoot(rootPageId: string, allPagesCount: number): IPageForTreeItem {
  return {
    _id: rootPageId,
    path: '/',
    descendantCount: allPagesCount,
    grant: 1,
    isEmpty: false,
    wip: false,
  };
}

const TEMP_PAGE_PREFIX = '__temp_creating_';

export const isTempPageId = (id: string): boolean => {
  return id.startsWith(TEMP_PAGE_PREFIX);
};

export const createTempPageId = (): string => {
  return `${TEMP_PAGE_PREFIX}${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

type TempPageData = {
  parentId: string;
  parentPath: string;
};

export const usePageTreeDataLoader = (
    rootPageId: string,
    allPagesCount: number,
): {
  dataLoader: TreeDataLoader<IPageForTreeItem>;
  tempPagesRef: React.MutableRefObject<Map<string, TempPageData>>;
  addTempPage: (tempId: string, parentId: string, parentPath: string) => void;
  removeTempPage: (tempId: string) => void;
  getTempPageData: (tempId: string) => TempPageData | undefined;
} => {
  const tempPagesRef = useRef<Map<string, TempPageData>>(new Map());

  const addTempPage = useCallback((tempId: string, parentId: string, parentPath: string) => {
    tempPagesRef.current.set(tempId, { parentId, parentPath });
  }, []);

  const removeTempPage = useCallback((tempId: string) => {
    tempPagesRef.current.delete(tempId);
  }, []);

  const getTempPageData = useCallback((tempId: string) => {
    return tempPagesRef.current.get(tempId);
  }, []);

  const getItem = useCallback(async (itemId: string): Promise<IPageForTreeItem> => {
    // Handle temporary pages
    if (isTempPageId(itemId)) {
      const tempData = tempPagesRef.current.get(itemId);
      if (tempData) {
        return {
          _id: itemId,
          path: '', // Empty path for new page
          parent: tempData.parentId,
          descendantCount: 0,
          grant: 1,
          isEmpty: true,
          wip: false,
        };
      }
    }

    // Virtual root (should rarely be called since it's provided by getChildrenWithData)
    if (itemId === ROOT_PAGE_VIRTUAL_ID) {
      return constructRootPageForVirtualRoot(rootPageId, allPagesCount);
    }

    // For all pages (including root), use /page-listing/item endpoint
    // Note: This should rarely be called thanks to getChildrenWithData caching
    const response = await apiv3Get<{ item: IPageForTreeItem }>('/page-listing/item', { id: itemId });
    return response.data.item;
  }, [allPagesCount, rootPageId]);

  const getChildrenWithData = useCallback(async (itemId: string) => {
    // Check if there are temporary pages for this parent
    const tempChildren: Array<{ id: string; data: IPageForTreeItem }> = [];
    tempPagesRef.current.forEach((tempData, tempId) => {
      if (tempData.parentId === itemId) {
        tempChildren.push({
          id: tempId,
          data: {
            _id: tempId,
            path: '',
            parent: itemId,
            descendantCount: 0,
            grant: 1,
            isEmpty: true,
            wip: false,
          },
        });
      }
    });

    // Virtual root returns root page as its only child
    // Use actual MongoDB _id as tree item ID to avoid duplicate API calls
    if (itemId === ROOT_PAGE_VIRTUAL_ID) {
      return [{
        id: rootPageId,
        data: constructRootPageForVirtualRoot(rootPageId, allPagesCount),
      }, ...tempChildren];
    }

    // For all pages (including root), fetch children using their _id
    const response = await apiv3Get<{ children: IPageForTreeItem[] }>('/page-listing/children', { id: itemId });
    const realChildren = response.data.children.map(child => ({
      id: child._id,
      data: child,
    }));

    // Return real children + temp children
    return [...realChildren, ...tempChildren];
  }, [allPagesCount, rootPageId]);

  return {
    dataLoader: { getItem, getChildrenWithData },
    tempPagesRef,
    addTempPage,
    removeTempPage,
    getTempPageData,
  };
};
