import { useEffect, useRef } from 'react';
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
  // Track the previous targetPathOrId to detect actual changes
  const prevTargetPathOrIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    // Only scroll when targetPathOrId actually changes, not on items change alone
    // This prevents unwanted scrolling when creating a new page (items update but targetPathOrId stays the same)
    if (targetPathOrId === prevTargetPathOrIdRef.current) return;
    prevTargetPathOrIdRef.current = targetPathOrId;

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
