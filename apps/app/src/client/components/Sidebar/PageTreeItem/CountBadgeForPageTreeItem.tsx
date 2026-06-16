import type { JSX } from 'react';

import type { TreeItemToolProps } from '~/features/page-tree/interfaces';
import { usePageTreeDescCountMap } from '~/features/page-tree/states';

import CountBadge from '../../Common/CountBadge';

export const CountBadgeForPageTreeItem = (
  props: TreeItemToolProps,
): JSX.Element => {
  const { getDescCount } = usePageTreeDescCountMap();

  const { item } = props;
  const page = item.getItemData();

  const descendantCount = getDescCount(page._id) || page.descendantCount || 0;

  return <>{descendantCount > 0 && <CountBadge count={descendantCount} />}</>;
};
