import React, { useCallback, useState, type JSX } from 'react';

import nodePath from 'path';

import type { IPageHasId, IPageInfoExt, IPageToDeleteWithMeta } from '@growi/core';
import { DevidedPagePath } from '@growi/core/dist/models';
import { pathUtils } from '@growi/core/dist/utils';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import { UncontrolledTooltip, DropdownToggle } from 'reactstrap';


import { bookmark, unbookmark, unlink } from '~/client/services/page-operation';
import { addBookmarkToFolder, renamePage } from '~/client/util/bookmark-utils';
import { toastError, toastSuccess } from '~/client/util/toastr';
import type { BookmarkFolderItems, DragItemDataType } from '~/interfaces/bookmark-info';
import { DRAG_ITEM_TYPE } from '~/interfaces/bookmark-info';
import { useFetchCurrentPage } from '~/states/page';
import { usePutBackPageModalActions } from '~/states/ui/modal/put-back-page';
import { mutateAllPageInfo, useSWRxPageInfo } from '~/stores/page';

import { MenuItemType, PageItemControl } from '../Common/Dropdown/PageItemControl';
import { PageListItemS } from '../PageList/PageListItemS';

import { BookmarkItemRenameInput } from './BookmarkItemRenameInput';
import { BookmarkMoveToRootBtn } from './BookmarkMoveToRootBtn';
import { DragAndDropWrapper } from './DragAndDropWrapper';

type Props = {
  isReadOnlyUser: boolean
  isOperable: boolean,
  bookmarkedPage: IPageHasId | null,
  level: number,
  parentFolder: BookmarkFolderItems | null,
  canMoveToRoot: boolean,
  onClickDeleteMenuItemHandler: (pageToDelete: IPageToDeleteWithMeta) => void,
  bookmarkFolderTreeMutation: () => void,
}

export const BookmarkItem = (props: Props): JSX.Element => {
  const BASE_FOLDER_PADDING = 15;
  const BASE_BOOKMARK_PADDING = 16;

  const { t } = useTranslation();
  const router = useRouter();

  const {
    isReadOnlyUser, isOperable, bookmarkedPage, onClickDeleteMenuItemHandler,
    parentFolder, level, canMoveToRoot, bookmarkFolderTreeMutation,
  } = props;
  const { open: openPutBackPageModal } = usePutBackPageModalActions();
  const [isRenameInputShown, setRenameInputShown] = useState(false);

  const { data: pageInfo, mutate: mutatePageInfo } = useSWRxPageInfo(bookmarkedPage?._id);
  const { fetchCurrentPage } = useFetchCurrentPage();

  const paddingLeft = BASE_BOOKMARK_PADDING + (BASE_FOLDER_PADDING * (level));
  const dragItem: Partial<DragItemDataType> = {
    ...bookmarkedPage, parentFolder,
  };

  const onClickMoveToRootHandler = useCallback(async() => {
    if (bookmarkedPage == null) return;

    try {
      await addBookmarkToFolder(bookmarkedPage._id, null);
      bookmarkFolderTreeMutation();
    }
    catch (err) {
      toastError(err);
    }
  }, [bookmarkFolderTreeMutation, bookmarkedPage]);

  const bookmarkMenuItemClickHandler = useCallback(async(pageId: string, shouldBookmark: boolean) => {
    if (shouldBookmark) {
      await bookmark(pageId);
    }
    else {
      await unbookmark(pageId);
    }
    bookmarkFolderTreeMutation();
    mutatePageInfo();
  }, [bookmarkFolderTreeMutation, mutatePageInfo]);

  const renameMenuItemClickHandler = useCallback(() => {
    setRenameInputShown(true);
  }, []);

  const cancel = useCallback(() => {
    setRenameInputShown(false);
  }, []);

  const rename = useCallback(async(inputText: string) => {
    if (bookmarkedPage == null) return;


    if (inputText.trim() === '') {
      return cancel();
    }

    const parentPath = pathUtils.addTrailingSlash(nodePath.dirname(bookmarkedPage.path ?? ''));
    const newPagePath = nodePath.resolve(parentPath, inputText.trim());
    if (newPagePath === bookmarkedPage.path) {
      setRenameInputShown(false);
      return;
    }

    try {
      setRenameInputShown(false);
      await renamePage(bookmarkedPage._id, bookmarkedPage.revision, newPagePath);
      bookmarkFolderTreeMutation();
      mutatePageInfo();
    }
    catch (err) {
      setRenameInputShown(true);
      toastError(err);
    }
  }, [bookmarkedPage, cancel, bookmarkFolderTreeMutation, mutatePageInfo]);

  const deleteMenuItemClickHandler = useCallback(async(_pageId: string, pageInfo: IPageInfoExt | undefined): Promise<void> => {
    if (bookmarkedPage == null) return;

    if (bookmarkedPage._id == null || bookmarkedPage.path == null) {
      throw Error('_id and path must not be null.');
    }

    const pageToDelete: IPageToDeleteWithMeta = {
      data: {
        _id: bookmarkedPage._id,
        revision: bookmarkedPage.revision as string,
        path: bookmarkedPage.path,
      },
      meta: pageInfo,
    };

    onClickDeleteMenuItemHandler(pageToDelete);
  }, [bookmarkedPage, onClickDeleteMenuItemHandler]);

  const putBackClickHandler = useCallback(() => {
    if (bookmarkedPage == null) return;

    const { _id: pageId, path } = bookmarkedPage;
    const putBackedHandler = async() => {
      try {
        await unlink(path);
        mutateAllPageInfo();
        bookmarkFolderTreeMutation();
        router.push(`/${pageId}`);
        fetchCurrentPage();
        toastSuccess(t('page_has_been_reverted', { path }));
      }
      catch (err) {
        toastError(err);
      }
    };
    openPutBackPageModal({ pageId, path }, { onPutBacked: putBackedHandler });
  }, [bookmarkedPage, openPutBackPageModal, bookmarkFolderTreeMutation, router, fetchCurrentPage, t]);

  if (bookmarkedPage == null) {
    return <></>;
  }

  const dPagePath = new DevidedPagePath(bookmarkedPage.path, false, true);
  const { latter: pageTitle, former: formerPagePath } = dPagePath;

  const bookmarkItemId = `bookmark-item-${bookmarkedPage._id}`;

  return (
    <DragAndDropWrapper
      item={dragItem}
      type={[DRAG_ITEM_TYPE.BOOKMARK]}
      useDragMode={isOperable}
    >
      <li
        className="grw-bookmark-item-list list-group-item list-group-item-action border-0 py-0 pe-1 me-auto d-flex align-items-center rounded-1"
        key={bookmarkedPage._id}
        id={bookmarkItemId}
        style={{ paddingLeft }}
      >
        { isRenameInputShown
          ? (
            <BookmarkItemRenameInput
              value={nodePath.basename(bookmarkedPage.path ?? '')}
              onSubmit={rename}
              onCancel={() => { setRenameInputShown(false) }}
            />
          )
          : <PageListItemS page={bookmarkedPage} pageTitle={pageTitle} isNarrowView />}

        <div className="grw-foldertree-control">
          <PageItemControl
            pageId={bookmarkedPage._id}
            isEnableActions
            isReadOnlyUser={isReadOnlyUser}
            pageInfo={pageInfo}
            isInstantRename
            forceHideMenuItems={[MenuItemType.DUPLICATE]}
            onClickBookmarkMenuItem={bookmarkMenuItemClickHandler}
            onClickRenameMenuItem={renameMenuItemClickHandler}
            onClickDeleteMenuItem={deleteMenuItemClickHandler}
            onClickRevertMenuItem={putBackClickHandler}
            additionalMenuItemOnTopRenderer={canMoveToRoot
              ? () => <BookmarkMoveToRootBtn pageId={bookmarkedPage._id} onClickMoveToRootHandler={onClickMoveToRootHandler} />
              : undefined}
          >
            <DropdownToggle color="transparent" className="border-0 rounded btn-page-item-control p-0 grw-visible-on-hover me-1">
              <span className="material-symbols-outlined p-1">more_vert</span>
            </DropdownToggle>
          </PageItemControl>
        </div>

        <UncontrolledTooltip
          autohide={false}
          placement="right"
          target={bookmarkItemId}
          fade={false}
        >
          {dPagePath.isFormerRoot ? '/' : `${formerPagePath}/`}
        </UncontrolledTooltip>
      </li>
    </DragAndDropWrapper>
  );
};
