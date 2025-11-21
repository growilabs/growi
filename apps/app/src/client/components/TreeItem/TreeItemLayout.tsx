import React, {
  useCallback,
  useEffect,
  useMemo,
  type MouseEvent,
  type JSX,
} from 'react';

import { addTrailingSlash } from '@growi/core/dist/utils/path-utils';

import { usePageTreeDescCountMap } from '~/states/ui/page-tree-desc-count-map';

import { SimpleItemContent } from './SimpleItemContent';
import type { TreeItemProps, TreeItemToolProps } from './interfaces';


import styles from './TreeItemLayout.module.scss';

const moduleClass = styles['tree-item-layout'] ?? '';


type TreeItemLayoutProps = TreeItemProps & {
  className?: string,
  indentSize?: number,
}

export const TreeItemLayout = (props: TreeItemLayoutProps): JSX.Element => {
  const {
    className, itemClassName,
    indentSize = 10,
    item: page,
    itemLevel: baseItemLevel = 1,
    targetPath, targetPathOrId, isExpanded = false,
    isEnableActions, isReadOnlyUser, isWipPageShown = true,
    showAlternativeContent,
    isRenaming, renameInputProps,
    onRenamed, onClick, onClickDuplicateMenuItem, onClickDeleteMenuItem, onWheelClick,
    onToggle, onStartCreatePage,
  } = props;

  const itemClickHandler = useCallback((e: MouseEvent) => {
    // DO NOT handle the event when e.currentTarget and e.target is different
    if (e.target !== e.currentTarget) {
      return;
    }

    onClick?.(page);

  }, [onClick, page]);

  const itemMouseupHandler = useCallback((e: MouseEvent) => {
    // DO NOT handle the event when e.currentTarget and e.target is different
    if (e.target !== e.currentTarget) {
      return;
    }

    if (e.button === 1) {
      e.preventDefault();
      onWheelClick?.(page);
    }

  }, [onWheelClick, page]);


  // descendantCount
  const { getDescCount } = usePageTreeDescCountMap();
  const descendantCount = getDescCount(page._id) || page.descendantCount || 0;

  // hasDescendants flag
  const hasDescendants = descendantCount > 0;

  // auto open if targetPath is descendant of this page
  useEffect(() => {
    if (isExpanded) return;

    const isPathToTarget = page.path != null
      && targetPath.startsWith(addTrailingSlash(page.path))
      && targetPath !== page.path; // Target Page does not need to be opened

    if (isPathToTarget) onToggle?.();
  }, [targetPath, page.path, isExpanded, onToggle]);

  const isSelected = useMemo(() => {
    return page._id === targetPathOrId || page.path === targetPathOrId;
  }, [page, targetPathOrId]);

  const toolProps: TreeItemToolProps = {
    item: page,
    itemLevel: baseItemLevel,
    isEnableActions,
    isReadOnlyUser,
    onRenamed,
    onClickDuplicateMenuItem,
    onClickDeleteMenuItem,
    onStartCreatePage,
  };

  const EndComponents = props.customEndComponents;
  const HoveredEndComponents = props.customHoveredEndComponents;
  const AlternativeComponents = props.customAlternativeComponents;

  if (!isWipPageShown && page.wip) {
    return <></>;
  }

  return (
    <div
      id={`tree-item-layout-${page._id}`}
      data-testid="grw-pagetree-item-container"
      className={`${moduleClass} ${className} level-${baseItemLevel}`}
      style={{ paddingLeft: `${baseItemLevel > 1 ? indentSize : 0}px` }}
    >
      <li
        role="button"
        className={`list-group-item list-group-item-action
          ${isSelected ? 'active' : ''}
          ${itemClassName ?? ''}
          border-0 py-0 ps-0 d-flex align-items-center rounded-1`}
        id={`grw-pagetree-list-${page._id}`}
        onClick={itemClickHandler}
        onMouseUp={itemMouseupHandler}
        aria-current={isSelected ? true : undefined}
      >

        <div className="btn-triangle-container d-flex justify-content-center">
          {hasDescendants && (
            <button
              type="button"
              className={`btn btn-triangle p-0 ${isExpanded ? 'open' : ''}`}
              onClick={onToggle}
            >
              <div className="d-flex justify-content-center">
                <span className="material-symbols-outlined fs-5">arrow_right</span>
              </div>
            </button>
          )}
        </div>

        {showAlternativeContent && AlternativeComponents != null
          ? (
            AlternativeComponents.map((AlternativeContent, index) => (
              // eslint-disable-next-line react/no-array-index-key
              (<AlternativeContent key={index} {...toolProps} />)
            ))
          )
          : isRenaming && renameInputProps
            ? (
              <input
                {...renameInputProps}
                className="form-control form-control-sm flex-fill"
                placeholder="Enter page name"
                autoFocus
              />
            )
            : (
              <>
                <SimpleItemContent page={page} />
                <div className="d-hover-none">
                  {EndComponents?.map((EndComponent, index) => (
                    // eslint-disable-next-line react/no-array-index-key
                    (<EndComponent key={index} {...toolProps} />)
                  ))}
                </div>
                <div className="d-none d-hover-flex">
                  {HoveredEndComponents?.map((HoveredEndContent, index) => (
                    // eslint-disable-next-line react/no-array-index-key
                    (<HoveredEndContent key={index} {...toolProps} />)
                  ))}
                </div>
              </>
            )
        }

      </li>
    </div>
  );
};
