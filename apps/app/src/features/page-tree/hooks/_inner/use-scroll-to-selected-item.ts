import { useEffect } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';

import type { IPageForTreeItem } from '~/interfaces/page';

type UseScrollToSelectedItemParams = {
  targetPathOrId?: string;
  items: Array<{ getItemData: () => IPageForTreeItem }>;
  virtualizer: Virtualizer<HTMLElement, Element>;
};

export const useScrollToSelectedItem = ({
  targetPathOrId,
  items,
  virtualizer,
}: UseScrollToSelectedItemParams): void => {
  useEffect(() => {
    if (targetPathOrId == null) return;

    const selectedIndex = items.findIndex((item) => {
      const itemData = item.getItemData();
      return (
        itemData._id === targetPathOrId || itemData.path === targetPathOrId
      );
    });

    if (selectedIndex !== -1) {
      // Use a small delay to ensure the virtualizer is ready
      setTimeout(() => {
        virtualizer.scrollToIndex(selectedIndex, {
          align: 'center',
          behavior: 'smooth',
        });
      }, 100);
    }
  }, [targetPathOrId, items, virtualizer]);
};
