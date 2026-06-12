import { Suspense, useCallback, useState } from 'react';

import ItemsTreeContentSkeleton from '~/client/components/ItemsTree/ItemsTreeContentSkeleton.js';
import { ItemsTree } from '~/features/page-tree/components/index.js';
import type { IPageForTreeItem } from '~/interfaces/page.js';

import {
  TreeItemWithCheckbox,
  treeItemWithCheckboxSize,
} from '~/features/openai/client/components/AiAssistant/AiAssistantManagementModal/TreeItemWithCheckbox.js';

type Props = {
  isEnableActions: boolean;
  isReadOnlyUser: boolean;
  initialCheckedItems: string[];
  onCheckedItemsChange: (checkedPages: IPageForTreeItem[]) => void;
};

export const PageTreeSelectionTree = (props: Props): JSX.Element => {
  const {
    isEnableActions,
    isReadOnlyUser,
    initialCheckedItems,
    onCheckedItemsChange,
  } = props;

  // Scroll container for virtualization
  const [scrollerElem, setScrollerElem] = useState<HTMLElement | null>(null);

  const estimateTreeItemSize = useCallback(() => treeItemWithCheckboxSize, []);

  return (
    <div className="page-tree-container" ref={setScrollerElem}>
      {scrollerElem != null && (
        <Suspense fallback={<ItemsTreeContentSkeleton />}>
          <ItemsTree
            targetPath="/"
            isEnableActions={isEnableActions}
            isReadOnlyUser={isReadOnlyUser}
            CustomTreeItem={TreeItemWithCheckbox}
            estimateTreeItemSize={estimateTreeItemSize}
            scrollerElem={scrollerElem}
            enableCheckboxes
            initialCheckedItems={initialCheckedItems}
            onCheckedItemsChange={onCheckedItemsChange}
          />
        </Suspense>
      )}
    </div>
  );
};
