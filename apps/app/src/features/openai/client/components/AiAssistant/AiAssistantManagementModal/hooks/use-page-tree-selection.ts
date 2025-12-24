import { useCallback, useMemo } from 'react';

import type { IPageForTreeItem } from '~/interfaces/page';

import {
  isSelectablePage,
  type SelectablePage,
} from '../../../../../interfaces/selectable-page';
import { useSelectedPages } from '../../../../services/use-selected-pages';

/**
 * Convert a page path to a glob pattern for selecting descendants.
 * Handles the root page case where '//*' should become '/*'.
 */
export const toPagePathGlob = (path: string): string => {
  if (path === '/') {
    return '/*';
  }
  return `${path}/*`;
};

type UsePageTreeSelectionReturn = {
  selectedPages: Map<string, SelectablePage>;
  selectedPagesArray: SelectablePage[];
  initialCheckedItems: string[];
  handleCheckedItemsChange: (checkedPages: IPageForTreeItem[]) => void;
  addPage: (page: SelectablePage) => void;
  removePage: (page: SelectablePage) => void;
};

export const usePageTreeSelection = (
  baseSelectedPages: SelectablePage[],
): UsePageTreeSelectionReturn => {
  const { selectedPages, selectedPagesArray, addPage, removePage } =
    useSelectedPages(baseSelectedPages);

  // Calculate initial checked items from baseSelectedPages
  // Remove the /* suffix to match with page IDs
  const initialCheckedItems = useMemo(() => {
    return baseSelectedPages
      .filter((page) => page._id != null)
      .map((page) => page._id as string);
  }, [baseSelectedPages]);

  // Handle checked items change from tree
  const handleCheckedItemsChange = useCallback(
    (checkedPages: IPageForTreeItem[]) => {
      // Get current checked page IDs (with /* suffix paths)
      const currentCheckedPaths = new Set(
        checkedPages
          .filter((page) => isSelectablePage(page) && page.path != null)
          .map((page) => toPagePathGlob(page.path as string)),
      );

      // Get currently selected page paths
      const currentSelectedPaths = new Set(selectedPages.keys());

      // Add newly checked pages
      checkedPages.forEach((page) => {
        if (!isSelectablePage(page) || page.path == null) {
          return;
        }
        const pagePathWithGlob = toPagePathGlob(page.path);
        if (!currentSelectedPaths.has(pagePathWithGlob)) {
          const clonedPage = { ...page, path: pagePathWithGlob };
          addPage(clonedPage as SelectablePage);
        }
      });

      // Remove unchecked pages
      selectedPagesArray.forEach((page) => {
        if (page.path != null && !currentCheckedPaths.has(page.path)) {
          removePage(page);
        }
      });
    },
    [selectedPages, selectedPagesArray, addPage, removePage],
  );

  return {
    selectedPages,
    selectedPagesArray,
    initialCheckedItems,
    handleCheckedItemsChange,
    addPage,
    removePage,
  };
};
