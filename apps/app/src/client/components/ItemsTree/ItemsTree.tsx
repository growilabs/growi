import React, { useEffect, useCallback, type JSX } from 'react';

import path from 'path';

import type { IPageToDeleteWithMeta } from '@growi/core';
import { useGlobalSocket } from '@growi/core/dist/swr';
import { useTranslation } from 'next-i18next';
import { useRouter } from 'next/router';

import { toastError, toastSuccess } from '~/client/util/toastr';
import type { IPageForItem } from '~/interfaces/page';
import type { OnDuplicatedFunction, OnDeletedFunction } from '~/interfaces/ui';
import type { UpdateDescCountData, UpdateDescCountRawData } from '~/interfaces/websocket';
import { SocketEventName } from '~/interfaces/websocket';
import type { IPageForPageDuplicateModal } from '~/stores/modal';
import { usePageDuplicateModal, usePageDeleteModal } from '~/stores/modal';
import { mutateAllPageInfo, useCurrentPagePath, useSWRMUTxCurrentPage } from '~/stores/page';
import {
  useSWRxRootPage, mutatePageTree, mutatePageList,
} from '~/stores/page-listing';
import { mutateSearching } from '~/stores/search';
import { usePageTreeDescCountMap } from '~/stores/ui';
import loggerFactory from '~/utils/logger';

import { ItemNode, type TreeItemProps } from '../TreeItem';

import ItemsTreeContentSkeleton from './ItemsTreeContentSkeleton';

import styles from './ItemsTree.module.scss';

const moduleClass = styles['items-tree'] ?? '';

const logger = loggerFactory('growi:cli:ItemsTree');

type ItemsTreeProps = {
  isEnableActions: boolean
  isReadOnlyUser: boolean
  isWipPageShown?: boolean
  targetPath: string
  targetPathOrId?: string,
  CustomTreeItem: React.FunctionComponent<TreeItemProps>
  onClickTreeItem?: (page: IPageForItem) => void;
}

/*
 * ItemsTree
 */
export const ItemsTree = (props: ItemsTreeProps): JSX.Element => {
  const {
    targetPath, targetPathOrId, isEnableActions, isReadOnlyUser, isWipPageShown, CustomTreeItem, onClickTreeItem,
  } = props;

  const { t } = useTranslation();
  const router = useRouter();

  const { data: rootPageResult, error } = useSWRxRootPage({ suspense: true });
  const { data: currentPagePath } = useCurrentPagePath();
  const { open: openDuplicateModal } = usePageDuplicateModal();
  const { open: openDeleteModal } = usePageDeleteModal();

  const { data: socket } = useGlobalSocket();
  const { data: ptDescCountMap, update: updatePtDescCountMap } = usePageTreeDescCountMap();

  // for mutation
  const { trigger: mutateCurrentPage } = useSWRMUTxCurrentPage();

  useEffect(() => {
    if (socket == null) {
      return;
    }

    socket.on(SocketEventName.UpdateDescCount, (data: UpdateDescCountRawData) => {
      // save to global state
      const newData: UpdateDescCountData = new Map(Object.entries(data));

      updatePtDescCountMap(newData);
    });

    return () => { socket.off(SocketEventName.UpdateDescCount) };

  }, [socket, ptDescCountMap, updatePtDescCountMap]);

  const onRenamed = useCallback((fromPath: string | undefined, toPath: string) => {
    mutatePageTree();
    mutateSearching();
    mutatePageList();

    if (currentPagePath === fromPath || currentPagePath === toPath) {
      mutateCurrentPage();
    }
  }, [currentPagePath, mutateCurrentPage]);

  const onClickDuplicateMenuItem = useCallback((pageToDuplicate: IPageForPageDuplicateModal) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const duplicatedHandler: OnDuplicatedFunction = (fromPath, toPath) => {
      toastSuccess(t('duplicated_pages', { fromPath }));

      mutatePageTree();
      mutateSearching();
      mutatePageList();
    };

    openDuplicateModal(pageToDuplicate, { onDuplicated: duplicatedHandler });
  }, [openDuplicateModal, t]);

  const onClickDeleteMenuItem = useCallback((pageToDelete: IPageToDeleteWithMeta) => {
    const onDeletedHandler: OnDeletedFunction = (pathOrPathsToDelete, isRecursively, isCompletely) => {
      if (typeof pathOrPathsToDelete !== 'string') {
        return;
      }

      if (isCompletely) {
        toastSuccess(t('deleted_pages_completely', { path: pathOrPathsToDelete }));
      }
      else {
        toastSuccess(t('deleted_pages', { path: pathOrPathsToDelete }));
      }

      mutatePageTree();
      mutateSearching();
      mutatePageList();
      mutateAllPageInfo();

      if (currentPagePath === pathOrPathsToDelete) {
        mutateCurrentPage();
        router.push(isCompletely ? path.dirname(pathOrPathsToDelete) : `/trash${pathOrPathsToDelete}`);
      }
    };

    openDeleteModal([pageToDelete], { onDeleted: onDeletedHandler });
  }, [currentPagePath, mutateCurrentPage, openDeleteModal, router, t]);


  if (error != null) {
    toastError(t('pagetree.error_retrieving_the_pagetree'));
    return <></>;
  }

  const initialItemNode = rootPageResult ? new ItemNode(rootPageResult.rootPage) : null;
  if (initialItemNode != null) {
    return (
      <ul className={`${moduleClass} list-group`}>
        <CustomTreeItem
          key={initialItemNode.page.path}
          targetPath={targetPath}
          targetPathOrId={targetPathOrId}
          itemNode={initialItemNode}
          isOpen
          isEnableActions={isEnableActions}
          isWipPageShown={isWipPageShown}
          isReadOnlyUser={isReadOnlyUser}
          onRenamed={onRenamed}
          onClickDuplicateMenuItem={onClickDuplicateMenuItem}
          onClickDeleteMenuItem={onClickDeleteMenuItem}
          onClick={onClickTreeItem}
        />
      </ul>
    );
  }

  return <ItemsTreeContentSkeleton />;
};
