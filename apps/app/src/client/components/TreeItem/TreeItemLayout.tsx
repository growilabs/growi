import React, {
  useCallback,
  useState,
  useEffect,
  useMemo,
  type RefObject,
  type RefCallback,
  type MouseEvent,
  type JSX,
} from 'react';

import { addTrailingSlash } from '@growi/core/dist/utils/path-utils';

import { useSWRxPageChildren } from '~/stores/page-listing';
import { usePageTreeDescCountMap } from '~/stores/ui';

import { ItemNode } from './ItemNode';
import { SimpleItemContent } from './SimpleItemContent';
import type { TreeItemProps, TreeItemToolProps } from './interfaces';


import styles from './TreeItemLayout.module.scss';

const moduleClass = styles['tree-item-layout'] ?? '';


type TreeItemLayoutProps = TreeItemProps & {
  className?: string,
  itemRef?: RefObject<any> | RefCallback<any>,
  indentSize?: number,
}

export const TreeItemLayout = (props: TreeItemLayoutProps): JSX.Element => {
  const {
    className, itemClassName,
    indentSize = 10,
    itemLevel: baseItemLevel = 1,
    itemNode, targetPath, targetPathOrId, isOpen: _isOpen = false,
    onRenamed, onClick, onClickDuplicateMenuItem, onClickDeleteMenuItem, onWheelClick,
    isEnableActions, isReadOnlyUser, isWipPageShown = true,
    itemRef, itemClass,
    showAlternativeContent,
  } = props;

  const { page } = itemNode;

  const [currentChildren, setCurrentChildren] = useState<ItemNode[]>([]);
  const [isOpen, setIsOpen] = useState(_isOpen);

  const { data } = useSWRxPageChildren(isOpen ? page._id : null);


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
  const isChildrenLoaded = currentChildren?.length > 0;
  const hasDescendants = descendantCount > 0 || isChildrenLoaded;

  const hasChildren = useCallback((): boolean => {
    return currentChildren != null && currentChildren.length > 0;
  }, [currentChildren]);

  const onClickLoadChildren = useCallback(() => {
    setIsOpen(!isOpen);
  }, [isOpen]);

  useEffect(() => {
    const isPathToTarget = page.path != null
      && targetPath.startsWith(addTrailingSlash(page.path))
      && targetPath !== page.path; // Target Page does not need to be opened
    if (isPathToTarget) setIsOpen(true);
  }, [targetPath, page.path]);

  /*
   * When swr fetch succeeded
   */
  useEffect(() => {
    if (isOpen && data != null) {
      const newChildren = ItemNode.generateNodesFromPages(data.children);
      setCurrentChildren(newChildren);
    }
  }, [data, isOpen, targetPathOrId]);

  const isSelected = useMemo(() => {
    return page._id === targetPathOrId || page.path === targetPathOrId;
  }, [page, targetPathOrId]);

  const ItemClassFixed = itemClass ?? TreeItemLayout;

  const baseProps: Omit<TreeItemProps, 'itemLevel' | 'itemNode'> = {
    isEnableActions,
    isReadOnlyUser,
    isOpen: false,
    isWipPageShown,
    targetPath,
    targetPathOrId,
    onRenamed,
    onClickDuplicateMenuItem,
    onClickDeleteMenuItem,
  };

  const toolProps: TreeItemToolProps = {
    ...baseProps,
    itemLevel: baseItemLevel,
    itemNode,
    stateHandlers: {
      setIsOpen,
    },
  };

  const EndComponents = props.customEndComponents;
  const HoveredEndComponents = props.customHoveredEndComponents;
  const HeadObChildrenComponents = props.customHeadOfChildrenComponents;
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
        ref={itemRef}
        role="button"
        className={`list-group-item list-group-item-action ${itemClassName}
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
              className={`btn btn-triangle p-0 ${isOpen ? 'open' : ''}`}
              onClick={onClickLoadChildren}
            >
              <div className="d-flex justify-content-center">
                <span className="material-symbols-outlined fs-5">arrow_right</span>
              </div>
            </button>
          )}
        </div>

        { showAlternativeContent && AlternativeComponents != null
          ? (
            AlternativeComponents.map((AlternativeContent, index) => (
              // eslint-disable-next-line react/no-array-index-key
              (<AlternativeContent key={index} {...toolProps} />)
            ))
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
      { isOpen && (
        <div className={`tree-item-layout-children level-${baseItemLevel + 1}`}>

          {HeadObChildrenComponents?.map((HeadObChildrenContents, index) => (
            // eslint-disable-next-line react/no-array-index-key
            (<HeadObChildrenContents key={index} {...toolProps} itemLevel={baseItemLevel + 1} />)
          ))}

          { hasChildren() && currentChildren.map((node) => {
            const itemProps = {
              ...baseProps,
              className,
              itemLevel: baseItemLevel + 1,
              itemNode: node,
              itemClass,
              itemClassName,
              onClick,
            };

            return (
              <ItemClassFixed key={node.page._id} {...itemProps} />
            );
          }) }

        </div>
      ) }
    </div>
  );
};
