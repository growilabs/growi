
import React, { useCallback } from 'react';

import type { IPageToDeleteWithMeta } from '@growi/core';
import { useTranslation } from 'next-i18next';
import { useRouter } from 'next/router';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

import { toastSuccess } from '~/client/util/toastr';
import type { OnDeletedFunction } from '~/interfaces/ui';
import { useIsReadOnlyUser } from '~/states/context';
import { useCurrentPageData } from '~/states/page';
import { usePageDeleteModalActions } from '~/states/ui/modal/page-delete';
import {
  useSWRxUserBookmarks, useSWRMUTxCurrentUserBookmarks,
} from '~/stores/bookmark';
import { useSWRxBookmarkFolderAndChild } from '~/stores/bookmark-folder';
import { mutateAllPageInfo, useSWRMUTxPageInfo } from '~/stores/page';

import { BookmarkFolderItem } from './BookmarkFolderItem';
import { BookmarkItem } from './BookmarkItem';

import styles from './BookmarkFolderTree.module.scss';

// type DragItemDataType = {
//   bookmarkFolder: BookmarkFolderItems
//   level: number
//   parentFolder: BookmarkFolderItems | null
//  } & IPageHasId

type Props = {
  isUserHomepage?: boolean,
  userId?: string,
  isOperable: boolean,
}

export const BookmarkFolderTree: React.FC<Props> = (props: Props) => {
  const { isUserHomepage, userId } = props;

  // const acceptedTypes: DragItemType[] = [DRAG_ITEM_TYPE.FOLDER, DRAG_ITEM_TYPE.BOOKMARK];
  const { t } = useTranslation();
  const router = useRouter();

  const isReadOnlyUser = useIsReadOnlyUser();
  const currentPage = useCurrentPageData();
  const { data: bookmarkFolders, mutate: mutateBookmarkFolders } = useSWRxBookmarkFolderAndChild(userId);
  const { data: userBookmarks, mutate: mutateUserBookmarks } = useSWRxUserBookmarks(userId ?? null);
  const { trigger: mutatePageInfo } = useSWRMUTxPageInfo(currentPage?._id ?? null);
  const { trigger: mutateCurrentUserBookmarks } = useSWRMUTxCurrentUserBookmarks();
  const { open: openDeleteModal } = usePageDeleteModalActions();

  const bookmarkFolderTreeMutation = useCallback(() => {
    mutateUserBookmarks();
    mutateCurrentUserBookmarks();
    mutatePageInfo();
    mutateBookmarkFolders();
  }, [mutateBookmarkFolders, mutatePageInfo, mutateCurrentUserBookmarks, mutateUserBookmarks]);

  const onClickDeleteMenuItemHandler = useCallback((pageToDelete: IPageToDeleteWithMeta) => {
    const pageDeletedHandler: OnDeletedFunction = (pathOrPathsToDelete, _isRecursively, isCompletely) => {
      if (typeof pathOrPathsToDelete !== 'string') return;
      toastSuccess(isCompletely ? t('deleted_pages_completely', { path: pathOrPathsToDelete }) : t('deleted_pages', { path: pathOrPathsToDelete }));
      bookmarkFolderTreeMutation();
      mutateAllPageInfo();
      if (pageToDelete.data._id === currentPage?._id && _isRecursively) {
        router.push(`/trash${currentPage.path}`);
      }
    };
    openDeleteModal([pageToDelete], { onDeleted: pageDeletedHandler });
  }, [openDeleteModal, t, bookmarkFolderTreeMutation, currentPage?._id, currentPage?.path, router]);

  /* TODO: update in bookmarks folder v2. */
  // const itemDropHandler = async(item: DragItemDataType, dragType: string | null | symbol) => {
  //   if (dragType === DRAG_ITEM_TYPE.FOLDER) {
  //     try {
  //       await updateBookmarkFolder(item.bookmarkFolder._id, item.bookmarkFolder.name, null);
  //       await mutateBookmarkData();
  //       toastSuccess(t('toaster.update_successed', { target: t('bookmark_folder.bookmark_folder'), ns: 'commons' }));
  //     }
  //     catch (err) {
  //       toastError(err);
  //     }
  //   }
  //   else {
  //     try {
  //       await addBookmarkToFolder(item._id, null);
  //       await mutateUserBookmarks();
  //       toastSuccess(t('toaster.add_succeeded', { target: t('bookmark_folder.bookmark'), ns: 'commons' }));
  //     }
  //     catch (err) {
  //       toastError(err);
  //     }
  //   }

  // };
  // const isDroppable = (item: DragItemDataType, dragType: string | null | symbol) => {
  //   if (dragType === DRAG_ITEM_TYPE.FOLDER) {
  //     const isRootFolder = item.level === 0;
  //     return !isRootFolder;
  //   }
  //   const isRootBookmark = item.parentFolder == null;
  //   return !isRootBookmark;

  // };

  return (
    <DndProvider backend={HTML5Backend}>

      <div className={`grw-folder-tree-container ${styles['grw-folder-tree-container']}`}>
        <ul className={`grw-foldertree ${styles['grw-foldertree']} list-group py-2`}>
          {bookmarkFolders?.map((bookmarkFolder) => {
            return (
              <BookmarkFolderItem
                key={bookmarkFolder._id}
                isReadOnlyUser={!!isReadOnlyUser}
                isOperable={props.isOperable}
                bookmarkFolder={bookmarkFolder}
                isOpen={false}
                level={0}
                root={bookmarkFolder._id}
                isUserHomepage={isUserHomepage}
                onClickDeleteMenuItemHandler={onClickDeleteMenuItemHandler}
                bookmarkFolderTreeMutation={bookmarkFolderTreeMutation}
              />
            );
          })}
          {userBookmarks?.map(userBookmark => (
            <div key={userBookmark?._id} className="grw-foldertree-item-container grw-root-bookmarks">
              <BookmarkItem
                isReadOnlyUser={!!isReadOnlyUser}
                isOperable={props.isOperable}
                bookmarkedPage={userBookmark}
                level={0}
                parentFolder={null}
                canMoveToRoot={false}
                onClickDeleteMenuItemHandler={onClickDeleteMenuItemHandler}
                bookmarkFolderTreeMutation={bookmarkFolderTreeMutation}
              />
            </div>
          ))}
        </ul>
        {/* TODO: update in bookmarks folder v2. Also delete drop_item_here in translation.json, if don't need it. */}
        {/* {bookmarkFolderData != null && bookmarkFolderData.length > 0 && (
          <DragAndDropWrapper
            useDropMode={true}
            type={acceptedTypes}
            onDropItem={itemDropHandler}
            isDropable={isDroppable}
          >
            <div className="grw-drop-item-area">
              <div className="d-flex flex-column align-items-center">
                {t('bookmark_folder.drop_item_here')}
              </div>
            </div>
          </DragAndDropWrapper>
        )} */}
      </div>

    </DndProvider>
  );
};
