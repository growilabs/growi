import React, {
  useCallback, useState, type JSX,
} from 'react';

import nodePath from 'path';

import type { IPageHasId } from '@growi/core';
import { pagePathUtils, pathUtils } from '@growi/core/dist/utils';
import { useTranslation } from 'next-i18next';
import { useRouter } from 'next/router';
import { useDrag, useDrop } from 'react-dnd';

import { apiv3Put } from '~/client/util/apiv3-client';
import { toastWarning, toastError } from '~/client/util/toastr';
import type { IPageForItem } from '~/interfaces/page';
import { mutatePageTree, useSWRxPageChildren } from '~/stores/page-listing';
import loggerFactory from '~/utils/logger';

import type { ItemNode } from '../../TreeItem';
import {
  TreeItemLayout, useNewPageInput, type TreeItemProps,
} from '../../TreeItem';

import { CountBadgeForPageTreeItem } from './CountBadgeForPageTreeItem';
import { CreatingNewPageSpinner } from './CreatingNewPageSpinner';
import { usePageItemControl } from './use-page-item-control';


import styles from './PageTreeItem.module.scss';

const moduleClass = styles['page-tree-item'] ?? '';


const logger = loggerFactory('growi:cli:Item');

export const PageTreeItem = (props:TreeItemProps): JSX.Element => {
  const router = useRouter();

  const getNewPathAfterMoved = (droppedPagePath: string, newParentPagePath: string): string => {
    const pageTitle = nodePath.basename(droppedPagePath);
    return nodePath.join(newParentPagePath, pageTitle);
  };

  const isDroppable = (fromPage?: Partial<IPageHasId>, newParentPage?: Partial<IPageHasId>, printLog = false): boolean => {
    if (fromPage == null || newParentPage == null || fromPage.path == null || newParentPage.path == null) {
      if (printLog) {
        logger.warn('Any of page, page.path or droppedPage.path is null');
      }
      return false;
    }

    const newPathAfterMoved = getNewPathAfterMoved(fromPage.path, newParentPage.path);
    return pagePathUtils.canMoveByPath(fromPage.path, newPathAfterMoved) && !pagePathUtils.isUsersTopPage(newParentPage.path);
  };

  const { t } = useTranslation();

  const {
    itemNode, targetPathOrId, isOpen: _isOpen = false, onRenamed,
  } = props;

  const { page } = itemNode;
  const [isOpen, setIsOpen] = useState(_isOpen);

  const { mutate: mutateChildren } = useSWRxPageChildren(isOpen ? page._id : null);

  const {
    showRenameInput, Control, RenameInput,
  } = usePageItemControl();
  const { isProcessingSubmission, Input: NewPageInput, CreateButton: NewPageCreateButton } = useNewPageInput();

  const itemSelectedHandler = useCallback((page: IPageForItem) => {
    if (page.path == null || page._id == null) {
      return;
    }

    const link = pathUtils.returnPathForURL(page.path, page._id);

    router.push(link);
  }, [router]);

  const itemSelectedByWheelClickHandler = useCallback((page: IPageForItem) => {
    if (page.path == null || page._id == null) {
      return;
    }

    const url = pathUtils.returnPathForURL(page.path, page._id);

    window.open(url, '_blank');
  }, []);

  const [, drag] = useDrag({
    type: 'PAGE_TREE',
    item: { page },
    canDrag: () => {
      if (page.path == null) {
        return false;
      }
      return !pagePathUtils.isUsersProtectedPages(page.path);
    },
    end: (item, monitor) => {
      // in order to set d-none to dropped Item
      const dropResult = monitor.getDropResult();
    },
    collect: monitor => ({
      isDragging: monitor.isDragging(),
      canDrag: monitor.canDrag(),
    }),
  });

  const pageItemDropHandler = async(item: ItemNode) => {
    const { page: droppedPage } = item;
    if (!isDroppable(droppedPage, page, true)) {
      return;
    }
    if (droppedPage.path == null || page.path == null) {
      return;
    }
    const newPagePath = getNewPathAfterMoved(droppedPage.path, page.path);
    try {
      await apiv3Put('/pages/rename', {
        pageId: droppedPage._id,
        revisionId: droppedPage.revision,
        newPagePath,
        isRenameRedirect: false,
        updateMetadata: true,
      });
      await mutatePageTree();
      await mutateChildren();
      if (onRenamed != null) {
        onRenamed(page.path, newPagePath);
      }
      // force open
      setIsOpen(true);
    }
    catch (err) {
      if (err.code === 'operation__blocked') {
        toastWarning(t('pagetree.you_cannot_move_this_page_now'));
      }
      else {
        toastError(t('pagetree.something_went_wrong_with_moving_page'));
      }
    }
  };

  const [{ isOver }, drop] = useDrop<ItemNode, Promise<void>, { isOver: boolean }>(
    () => ({
      accept: 'PAGE_TREE',
      drop: pageItemDropHandler,
      hover: (item, monitor) => {
        // when a drag item is overlapped more than 1 sec, the drop target item will be opened.
        if (monitor.isOver()) {
          setTimeout(() => {
            if (monitor.isOver()) {
              setIsOpen(true);
            }
          }, 600);
        }
      },
      canDrop: (item) => {
        const { page: droppedPage } = item;
        return isDroppable(droppedPage, page);
      },
      collect: monitor => ({
        isOver: monitor.isOver(),
      }),
    }),
    [page],
  );

  const itemRef = (c) => {
    // do not apply when RenameInput is shown
    if (showRenameInput) return;

    drag(c);
    drop(c);
  };

  const isSelected = page._id === targetPathOrId || page.path === targetPathOrId;
  const itemClassNames = [
    isOver ? 'drag-over' : '',
    page.path !== '/' && isSelected ? 'active' : '', // set 'active' except the root page
  ];

  return (
    <TreeItemLayout
      className={moduleClass}
      targetPath={props.targetPath}
      targetPathOrId={props.targetPathOrId}
      itemLevel={props.itemLevel}
      itemNode={props.itemNode}
      isOpen={isOpen}
      isEnableActions={props.isEnableActions}
      isReadOnlyUser={props.isReadOnlyUser}
      isWipPageShown={props.isWipPageShown}
      onClick={itemSelectedHandler}
      onClickDuplicateMenuItem={props.onClickDuplicateMenuItem}
      onClickDeleteMenuItem={props.onClickDeleteMenuItem}
      onWheelClick={itemSelectedByWheelClickHandler}
      onRenamed={props.onRenamed}
      itemRef={itemRef}
      itemClass={PageTreeItem}
      itemClassName={itemClassNames.join(' ')}
      customEndComponents={[CountBadgeForPageTreeItem]}
      customHoveredEndComponents={[Control, NewPageCreateButton]}
      customHeadOfChildrenComponents={[NewPageInput, () => <CreatingNewPageSpinner show={isProcessingSubmission} />]}
      showAlternativeContent={showRenameInput}
      customAlternativeComponents={[RenameInput]}
    />
  );
};
