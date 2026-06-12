import type { JSX } from 'react';

import CountBadge from '~/client/components/Common/CountBadge.js';
import type { TreeItemToolProps } from '~/features/page-tree/interfaces/index.js';
import { usePageTreeDescCountMap } from '~/features/page-tree/states/index.js';

export const CountBadgeForPageTreeItem = (
  props: TreeItemToolProps,
): JSX.Element => {
  const { getDescCount } = usePageTreeDescCountMap();

  const { item } = props;
  const page = item.getItemData();

  const descendantCount = getDescCount(page._id) || page.descendantCount || 0;

  return <>{descendantCount > 0 && <CountBadge count={descendantCount} />}</>;
};
