import { apiv3Get } from '~/client/util/apiv3-client';
import type { IPageForTreeItem } from '~/interfaces/page';

export type ChildrenData = { id: string; data: IPageForTreeItem }[];

/**
 * Pending requests for concurrent deduplication
 * Note: Sequential cache is handled by headless-tree's internal cache
 */
const pending = new Map<string, Promise<ChildrenData>>();

/**
 * Clear pending requests (for cache invalidation scenarios)
 */
export const invalidatePageTreeChildren = (itemIds?: string[]): void => {
  if (itemIds == null) {
    pending.clear();
  } else {
    itemIds.forEach((id) => {
      pending.delete(id);
    });
  }
};

/**
 * Fetch children data with concurrent request deduplication
 * Sequential caching is delegated to headless-tree's internal cache
 */
export const fetchAndCacheChildren = async (
  itemId: string,
): Promise<ChildrenData> => {
  const existing = pending.get(itemId);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const response = await apiv3Get<{ children: IPageForTreeItem[] }>(
        '/page-listing/children',
        { id: itemId },
      );
      return response.data.children.map((child) => ({
        id: child._id,
        data: child,
      }));
    } finally {
      pending.delete(itemId);
    }
  })();

  pending.set(itemId, promise);

  return promise;
};
