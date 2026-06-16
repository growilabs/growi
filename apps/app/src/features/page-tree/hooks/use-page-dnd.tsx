import type { CSSProperties, FC, ReactNode } from 'react';
import { useCallback, useMemo } from 'react';
import { pagePathUtils } from '@growi/core/dist/utils';
import type {
  DragTarget,
  ItemInstance,
  TreeInstance,
} from '@headless-tree/core';
import { basename, join } from 'pathe';

import { apiv3Put } from '~/client/util/apiv3-client';
import type { IPageForTreeItem } from '~/interfaces/page';
import { mutatePageTree } from '~/stores/page-listing';

import { usePageTreeInformationUpdate } from '../states/page-tree-update';

import styles from './use-page-dnd.module.scss';

/**
 * Calculate new path after moving a page to a new parent
 * @param fromPath - The original path of the page being moved
 * @param newParentPath - The path of the new parent page
 * @returns The new path after the move
 */
export const getNewPathAfterMoved = (
  fromPath: string,
  newParentPath: string,
): string => {
  const pageTitle = basename(fromPath);
  return join(newParentPath, pageTitle);
};

/**
 * Check if selected items have ancestor-descendant relationship
 * (e.g., if both /A and /A/B are selected, they have an ancestor-descendant relationship)
 * @param items - Array of tree item instances
 * @returns true if any pair has ancestor-descendant relationship
 */
export const hasAncestorDescendantRelation = (
  items: ItemInstance<IPageForTreeItem>[],
): boolean => {
  const paths = items
    .map((item) => item.getItemData().path)
    .filter((path): path is string => path != null);

  for (let i = 0; i < paths.length; i++) {
    for (let j = 0; j < paths.length; j++) {
      if (i === j) continue;
      // Check if paths[i] is an ancestor of paths[j]
      if (paths[j].startsWith(`${paths[i]}/`)) {
        return true;
      }
    }
  }
  return false;
};

/**
 * Error types for page move operations
 */
export type PageMoveErrorType = 'operation_blocked' | 'unknown';

/**
 * Result of a page move operation
 */
export type PageMoveResult = {
  success: boolean;
  errorType?: PageMoveErrorType;
};

/**
 * Props for DragLine component
 */
type DragLineProps = {
  style: CSSProperties;
  className?: string;
};

/**
 * Drag line indicator component
 */
const DragLine: FC<DragLineProps> = ({ style, className }) => (
  <div
    style={style}
    className={`${styles['tree-drag-line']} ${className ?? ''}`}
  />
);

export type UsePageDndProperties = {
  canDrag: (items: ItemInstance<IPageForTreeItem>[]) => boolean;
  canDrop: (
    items: ItemInstance<IPageForTreeItem>[],
    target: DragTarget<IPageForTreeItem>,
  ) => boolean;
  onDrop: (
    items: ItemInstance<IPageForTreeItem>[],
    target: DragTarget<IPageForTreeItem>,
  ) => Promise<PageMoveResult>;
  /**
   * Render the drag line indicator
   * @param tree - The tree instance from headless-tree
   * @returns A DragLine component with proper positioning, or null if D&D is disabled
   */
  renderDragLine: (tree: TreeInstance<IPageForTreeItem>) => ReactNode;
};

/**
 * Hook to handle page drag and drop operations
 *
 * Responsibilities:
 * - Determine if items can be dragged (canDrag)
 * - Determine if items can be dropped on a target (canDrop)
 * - Execute page move API call and tree refresh (onDrop)
 * - Provide drag line rendering (renderDragLine)
 *
 * Note: Toast notifications should be handled by the caller based on PageMoveResult
 *
 * @returns Object with canDrag, canDrop, onDrop handlers and renderDragLine
 */
export const usePageDnd = (
  isEnabled: boolean = false,
): UsePageDndProperties => {
  const { notifyUpdateItems } = usePageTreeInformationUpdate();

  /**
   * Determine if items can be dragged
   */
  const canDrag = useCallback(
    (items: ItemInstance<IPageForTreeItem>[]): boolean => {
      // Prevent drag if ancestor-descendant relationship exists
      if (hasAncestorDescendantRelation(items)) {
        return false;
      }

      // Check if all items can be dragged
      return items.every((item) => {
        const page = item.getItemData();
        if (page.path == null) return false;
        // Protected user pages cannot be dragged
        return !pagePathUtils.isUsersProtectedPages(page.path);
      });
    },
    [],
  );

  /**
   * Determine if items can be dropped on target
   */
  const canDrop = useCallback(
    (
      items: ItemInstance<IPageForTreeItem>[],
      target: DragTarget<IPageForTreeItem>,
    ): boolean => {
      const targetItem = target.item;
      if (targetItem == null) return false;

      const targetPage = targetItem.getItemData();
      if (targetPage.path == null) return false;

      // Prevent drop on users top page
      if (pagePathUtils.isUsersTopPage(targetPage.path)) {
        return false;
      }

      // Check if all items can be moved to the target
      return items.every((item) => {
        const fromPage = item.getItemData();
        if (fromPage.path == null) return false;

        const newPathAfterMoved = getNewPathAfterMoved(
          fromPage.path,
          targetPage.path,
        );
        return pagePathUtils.canMoveByPath(fromPage.path, newPathAfterMoved);
      });
    },
    [],
  );

  /**
   * Handle drop event - move pages to new parent
   * Returns result with success/failure info for caller to handle UI feedback
   */
  const onDrop = useCallback(
    async (
      items: ItemInstance<IPageForTreeItem>[],
      target: DragTarget<IPageForTreeItem>,
    ): Promise<PageMoveResult> => {
      const targetItem = target.item;
      if (targetItem == null) return { success: false, errorType: 'unknown' };

      const targetPage = targetItem.getItemData();
      if (targetPage.path == null)
        return { success: false, errorType: 'unknown' };

      // Collect parent IDs for tree invalidation
      const parentIdsToInvalidate = new Set<string>();

      for (const item of items) {
        const fromPage = item.getItemData();
        if (fromPage.path == null) continue;

        // Track original parent for invalidation
        if (fromPage.parent) {
          parentIdsToInvalidate.add(String(fromPage.parent));
        }

        const newPagePath = getNewPathAfterMoved(
          fromPage.path,
          targetPage.path,
        );

        try {
          await apiv3Put('/pages/rename', {
            pageId: fromPage._id,
            revisionId: fromPage.revision,
            newPagePath,
            isRenameRedirect: false,
            updateMetadata: true,
          });
        } catch (err) {
          const errorType: PageMoveErrorType =
            (err as { code?: string }).code === 'operation__blocked'
              ? 'operation_blocked'
              : 'unknown';
          return { success: false, errorType };
        }
      }

      // Add target (new parent) to invalidation list
      parentIdsToInvalidate.add(targetPage._id);

      // Refresh SWR cache
      await mutatePageTree();

      // Invalidate headless-tree items (source parents and target)
      notifyUpdateItems(Array.from(parentIdsToInvalidate));

      // Invalidate target item's data (descendantCount changed) and expand it
      // Use await to ensure data is refreshed before expanding
      await targetItem.invalidateItemData();
      targetItem.expand();

      return { success: true };
    },
    [notifyUpdateItems],
  );

  /**
   * Render the drag line indicator
   * Returns null if D&D is disabled
   */
  const renderDragLine = useCallback(
    (tree: TreeInstance<IPageForTreeItem>): ReactNode => {
      if (!isEnabled) return null;
      return <DragLine style={tree.getDragLineStyle()} />;
    },
    [isEnabled],
  );

  return useMemo(
    () => ({
      canDrag,
      canDrop,
      onDrop,
      renderDragLine,
    }),
    [canDrag, canDrop, onDrop, renderDragLine],
  );
};
