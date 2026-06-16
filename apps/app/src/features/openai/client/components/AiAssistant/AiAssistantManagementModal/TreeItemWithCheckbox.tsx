import type { FC } from 'react';

import type {
  TreeItemProps,
  TreeItemWithCheckboxToolProps,
} from '~/features/page-tree';
import { TreeItemLayout } from '~/features/page-tree/components';

import styles from './TreeItemWithCheckbox.module.scss';

const moduleClass = styles['page-tree-item'] ?? '';

export const treeItemWithCheckboxSize = 36; // in px

// Checkbox component to be used as customEndComponents
const TreeItemCheckbox: FC<TreeItemWithCheckboxToolProps> = ({ item }) => {
  const checkboxProps = item.getCheckboxProps();

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    item.toggleCheckedState();
  };

  // Prevent click events from bubbling up to the li element
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: click handler only prevents propagation
    // biome-ignore lint/a11y/noStaticElementInteractions: wrapper div to stop click propagation
    <div
      onClick={handleClick}
      className="form-check form-switch d-flex align-items-center"
    >
      <input
        className="form-check-input"
        type="checkbox"
        role="switch"
        aria-checked={checkboxProps.checked ?? false}
        aria-label="Toggle selection"
        checked={checkboxProps.checked ?? false}
        onChange={handleCheckboxChange}
      />
    </div>
  );
};

type TreeItemWithCheckboxProps = TreeItemProps & {
  key?: React.Key | null;
};

export const TreeItemWithCheckbox: FC<TreeItemWithCheckboxProps> = (props) => {
  return (
    <TreeItemLayout
      {...props}
      className={moduleClass}
      customEndComponents={[TreeItemCheckbox]}
      customHoveredEndComponents={[TreeItemCheckbox]}
    />
  );
};
