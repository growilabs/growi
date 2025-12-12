import type { FC } from 'react';
import { useCallback, useMemo } from 'react';

import type { TreeItemProps } from '~/features/page-tree';
import { TreeItemLayout } from '~/features/page-tree/components';
import type { IPageForItem } from '~/interfaces/page';
import { useSelectPageInModal } from '~/states/ui/modal/page-select';

import styles from './TreeItemForModal.module.scss';

const moduleClass = styles['tree-item-for-modal'] ?? '';

export const treeItemForModalSize = 36; // in px

type TreeItemForModalProps = TreeItemProps & {
  key?: React.Key | null;
};

export const TreeItemForModal: FC<TreeItemForModalProps> = (props) => {
  const {
    item,
    targetPathOrId,
    onToggle,
  } = props;

  const page = item.getItemData();
  const selectPage = useSelectPageInModal();

  // Determine if this item is selected
  const isSelected = useMemo(() => {
    return page._id === targetPathOrId || page.path === targetPathOrId;
  }, [page._id, page.path, targetPathOrId]);

  // Handle click to select this page
  const handleClick = useCallback((selectedPage: IPageForItem) => {
    selectPage(selectedPage);
  }, [selectPage]);

  const itemClassNames = [
    isSelected ? 'active' : '',
  ];

  return (
    <TreeItemLayout
      {...props}
      className={moduleClass}
      itemClassName={itemClassNames.join(' ')}
      onClick={handleClick}
      onToggle={onToggle}
    />
  );
};
