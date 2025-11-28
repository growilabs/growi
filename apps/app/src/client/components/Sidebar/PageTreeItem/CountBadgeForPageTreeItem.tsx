import type { JSX } from 'react';

import CountBadge from '~/client/components/Common/CountBadge';
import type { TreeItemToolProps } from '~/client/components/TreeItem';
import { usePageTreeDescCountMap } from '~/states/ui/page-tree-desc-count-map';


export const CountBadgeForPageTreeItem = (props: TreeItemToolProps): JSX.Element => {
  const { getDescCount } = usePageTreeDescCountMap();

  const { page } = props.itemNode;

  const descendantCount = getDescCount(page._id) || page.descendantCount || 0;

  return (
    <>
      {descendantCount > 0 && (
        <CountBadge count={descendantCount} />
      )}
    </>
  );
};
