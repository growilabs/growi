import React, { useEffect, useCallback, type JSX } from 'react';

import path from 'path';

import type { IPageToDeleteWithMeta } from '@growi/core';
import { useTranslation } from 'next-i18next';
import { useRouter } from 'next/router';

import { toastError, toastSuccess } from '~/client/util/toastr';
import type { IPageForItem } from '~/interfaces/page';
import type { OnDuplicatedFunction, OnDeletedFunction } from '~/interfaces/ui';
import type { UpdateDescCountData, UpdateDescCountRawData } from '~/interfaces/websocket';
import { SocketEventName } from '~/interfaces/websocket';
import { useCurrentPagePath, useFetchCurrentPage } from '~/states/page';
import { useGlobalSocket } from '~/states/socket-io';
import { usePageDeleteModalActions } from '~/states/ui/modal/page-delete';
import type { IPageForPageDuplicateModal } from '~/states/ui/modal/page-duplicate';
import { usePageDuplicateModalActions } from '~/states/ui/modal/page-duplicate';
import { usePageTreeDescCountMapAction } from '~/states/ui/page-tree-desc-count-map';
import { mutateAllPageInfo } from '~/stores/page';
import {
  useSWRxRootPage, mutatePageTree, mutatePageList,
} from '~/stores/page-listing';
import { mutateSearching } from '~/stores/search';
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
  const currentPagePath = useCurrentPagePath();
  const { open: openDuplicateModal } = usePageDuplicateModalActions();
  const { open: openDeleteModal } = usePageDeleteModalActions();

  const socket = useGlobalSocket();
  const { update: updatePtDescCountMap } = usePageTreeDescCountMapAction();

  // for mutation
  const { fetchCurrentPage } = useFetchCurrentPage();

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

  }, [socket, updatePtDescCountMap]);

  const onRenamed = useCallback((fromPath: string | undefined, toPath: string) => {
    mutatePageTree();
    mutateSearching();
    mutatePageList();

    if (currentPagePath === fromPath || currentPagePath === toPath) {
      fetchCurrentPage({ force: true });
    }
  }, [currentPagePath, fetchCurrentPage]);

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
        fetchCurrentPage({ force: true });
        router.push(isCompletely ? path.dirname(pathOrPathsToDelete) : `/trash${pathOrPathsToDelete}`);
      }
    };

    openDeleteModal([pageToDelete], { onDeleted: onDeletedHandler });
  }, [currentPagePath, fetchCurrentPage, openDeleteModal, router, t]);


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
