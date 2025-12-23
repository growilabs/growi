import type { JSX, MouseEvent } from 'react';
import { useCallback, useMemo } from 'react';

import type { TreeItemProps, TreeItemToolProps } from '../interfaces';
import { SimpleItemContent } from './SimpleItemContent';

import styles from './TreeItemLayout.module.scss';

const moduleClass = styles['tree-item-layout'] ?? '';

const indentSize = 10; // in px

type TreeItemLayoutProps = TreeItemProps & {
  className?: string;
};

export const TreeItemLayout = (props: TreeItemLayoutProps): JSX.Element => {
  const {
    className,
    itemClassName,
    item,
    targetPathOrId,
    isEnableActions,
    isReadOnlyUser,
    isWipPageShown = true,
    showAlternativeContent,
    onRenamed,
    onClick,
    onClickDuplicateMenuItem,
    onClickDeleteMenuItem,
    onWheelClick,
    onToggle,
  } = props;

  const page = item.getItemData();
  const itemLevel = item.getItemMeta().level;

  const toggleHandler = useCallback(() => {
    if (item.isExpanded()) {
      item.collapse();
    } else {
      item.expand();
    }

    onToggle?.();
  }, [item, onToggle]);

  const itemClickHandler = useCallback(
    (e: MouseEvent) => {
      // DO NOT handle the event when e.currentTarget and e.target is different
      if (e.target !== e.currentTarget) {
        return;
      }

      onClick?.(page);
    },
    [onClick, page],
  );

  const itemMouseupHandler = useCallback(
    (e: MouseEvent) => {
      // DO NOT handle the event when e.currentTarget and e.target is different
      if (e.target !== e.currentTarget) {
        return;
      }

      if (e.button === 1) {
        e.preventDefault();
        onWheelClick?.(page);
      }
    },
    [onWheelClick, page],
  );

  // Use item.isFolder() which is evaluated by headless-tree's isItemFolder config
  // This will be re-evaluated after rebuildTree()
  const hasDescendants = item.isFolder();

  const isSelected = useMemo(() => {
    return page._id === targetPathOrId || page.path === targetPathOrId;
  }, [page, targetPathOrId]);

  // Check if this item is a drag target (being dragged over)
  const isDragTarget = item.isDragTarget?.() ?? false;

  const toolProps: TreeItemToolProps = {
    item,
    isEnableActions,
    isReadOnlyUser,
    onRenamed,
    onClickDuplicateMenuItem,
    onClickDeleteMenuItem,
  };

  const EndComponents = props.customEndComponents;
  const HoveredEndComponents = props.customHoveredEndComponents;
  const AlternativeComponents = props.customAlternativeComponents;

  if (!isWipPageShown && page.wip) {
    // biome-ignore lint/complexity/noUselessFragments: ignore
    return <></>;
  }

  return (
    <div
      id={`tree-item-layout-${page._id}`}
      data-testid="grw-pagetree-item-container"
      className={`${moduleClass} ${className}`}
      style={{ paddingLeft: `${itemLevel > 0 ? indentSize * itemLevel : 0}px` }}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: tree item interaction */}
      <li
        className={`list-group-item list-group-item-action
          ${isSelected ? 'active' : ''}
          ${isDragTarget ? 'drag-target' : ''}
          ${itemClassName ?? ''}
          border-0 py-0 ps-0 d-flex align-items-center rounded-1`}
        id={`grw-pagetree-list-${page._id}`}
        onClick={itemClickHandler}
        onMouseUp={itemMouseupHandler}
      >
        <div className="btn-triangle-container d-flex justify-content-center">
          {hasDescendants && (
            <button
              type="button"
              className={`btn btn-triangle p-0 ${item.isExpanded() ? 'open' : ''}`}
              onClick={toggleHandler}
            >
              <div className="d-flex justify-content-center">
                <span className="material-symbols-outlined fs-5">
                  arrow_right
                </span>
              </div>
            </button>
          )}
        </div>

        {showAlternativeContent && AlternativeComponents != null ? (
          AlternativeComponents.map((AlternativeContent, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static component list
            <AlternativeContent key={index} {...toolProps} />
          ))
        ) : (
          <>
            <SimpleItemContent page={page} />
            <div className="d-hover-none">
              {EndComponents?.map((EndComponent, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static component list
                <EndComponent key={index} {...toolProps} />
              ))}
            </div>
            <div className="d-none d-hover-flex">
              {HoveredEndComponents?.map((HoveredEndContent, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static component list
                <HoveredEndContent key={index} {...toolProps} />
              ))}
            </div>
          </>
        )}
      </li>
    </div>
  );
};
