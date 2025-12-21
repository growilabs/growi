import type { FC } from 'react';
import { useCallback, useState } from 'react';
import type { IPageToDeleteWithMeta } from '@growi/core';
import { DropdownToggle } from 'reactstrap';

import { FolderIcon } from '~/client/components/Icons/FolderIcon';
import {
  addBookmarkToFolder,
  addNewFolder,
  hasChildren,
  updateBookmarkFolder,
} from '~/client/util/bookmark-utils';
import { toastError } from '~/client/util/toastr';
import type {
  BookmarkFolderItems,
  DragItemDataType,
  DragItemType,
} from '~/interfaces/bookmark-info';
import { DRAG_ITEM_TYPE } from '~/interfaces/bookmark-info';
import type { onDeletedBookmarkFolderFunction } from '~/interfaces/ui';
import { useDeleteBookmarkFolderModalActions } from '~/states/ui/modal/delete-bookmark-folder';

import { BookmarkFolderItemControl } from './BookmarkFolderItemControl';
import { BookmarkFolderNameInput } from './BookmarkFolderNameInput';
import { BookmarkItem } from './BookmarkItem';
import { DragAndDropWrapper } from './DragAndDropWrapper';

type BookmarkFolderItemProps = {
  isReadOnlyUser: boolean;
  bookmarkFolder: BookmarkFolderItems;
  isOpen?: boolean;
  isOperable: boolean;
  level: number;
  root: string;
  isUserHomepage?: boolean;
  onClickDeleteMenuItemHandler: (pageToDelete: IPageToDeleteWithMeta) => void;
  bookmarkFolderTreeMutation: () => void;
};

export const BookmarkFolderItem: FC<BookmarkFolderItemProps> = (
  props: BookmarkFolderItemProps,
) => {
  const BASE_FOLDER_PADDING = 15;
  const acceptedTypes: DragItemType[] = [
    DRAG_ITEM_TYPE.FOLDER,
    DRAG_ITEM_TYPE.BOOKMARK,
  ];
  const {
    isReadOnlyUser,
    bookmarkFolder,
    isOpen: _isOpen = false,
    isOperable,
    level,
    root,
    isUserHomepage,
    onClickDeleteMenuItemHandler,
    bookmarkFolderTreeMutation,
  } = props;

  const {
    name,
    _id: folderId,
    childFolder,
    parent,
    bookmarks,
  } = bookmarkFolder;

  const [targetFolder, setTargetFolder] = useState<string | null>(folderId);
  const [isOpen, setIsOpen] = useState(_isOpen);
  const [isRenameAction, setIsRenameAction] = useState<boolean>(false);
  const [isCreateAction, setIsCreateAction] = useState<boolean>(false);

  const { open: openDeleteBookmarkFolderModal } =
    useDeleteBookmarkFolderModalActions();

  const childrenExists = hasChildren({ childFolder, bookmarks });

  const paddingLeft = BASE_FOLDER_PADDING * level;

  const loadChildFolder = useCallback(async () => {
    setIsOpen(!isOpen);
    setTargetFolder(folderId);
  }, [folderId, isOpen]);

  const cancel = useCallback(() => {
    setIsRenameAction(false);
    setIsCreateAction(false);
  }, []);

  // Rename for bookmark folder handler
  const rename = useCallback(
    async (folderName: string) => {
      if (folderName.trim() === '') {
        return cancel();
      }

      try {
        // TODO: do not use any type
        await updateBookmarkFolder(
          folderId,
          folderName.trim(),
          parent as any,
          childFolder,
        );
        bookmarkFolderTreeMutation();
        setIsRenameAction(false);
      } catch (err) {
        toastError(err);
      }
    },
    [bookmarkFolderTreeMutation, cancel, childFolder, folderId, parent],
  );

  // Create new folder / subfolder handler
  const create = useCallback(
    async (folderName: string) => {
      if (folderName.trim() === '') {
        return cancel();
      }

      try {
        await addNewFolder(folderName.trim(), targetFolder);
        setIsOpen(true);
        setIsCreateAction(false);
        bookmarkFolderTreeMutation();
      } catch (err) {
        toastError(err);
      }
    },
    [bookmarkFolderTreeMutation, cancel, targetFolder],
  );

  const onClickPlusButton = useCallback(
    async (e) => {
      e.stopPropagation();
      if (!isOpen && childrenExists) {
        setIsOpen(true);
      }
      setIsCreateAction(true);
    },
    [childrenExists, isOpen],
  );

  const itemDropHandler = async (
    item: DragItemDataType,
    dragItemType: string | symbol | null,
  ) => {
    if (dragItemType === DRAG_ITEM_TYPE.FOLDER) {
      try {
        if (item.bookmarkFolder != null) {
          await updateBookmarkFolder(
            item.bookmarkFolder._id,
            item.bookmarkFolder.name,
            bookmarkFolder._id,
            item.bookmarkFolder.childFolder,
          );
          bookmarkFolderTreeMutation();
        }
      } catch (err) {
        toastError(err);
      }
    } else {
      try {
        if (item != null) {
          await addBookmarkToFolder(item._id, bookmarkFolder._id);
          bookmarkFolderTreeMutation();
        }
      } catch (err) {
        toastError(err);
      }
    }
  };

  const isDropable = (
    item: DragItemDataType,
    type: string | null | symbol,
  ): boolean => {
    if (type === DRAG_ITEM_TYPE.FOLDER) {
      if (
        item.bookmarkFolder.parent === bookmarkFolder._id ||
        item.bookmarkFolder._id === bookmarkFolder._id
      ) {
        return false;
      }

      // Maximum folder hierarchy of 2 levels
      // If the drop source folder has child folders, the drop source folder cannot be moved because the drop source folder hierarchy is already 2.
      // If the destination folder has a parent, the source folder cannot be moved because the destination folder hierarchy is already 2.
      if (
        item.bookmarkFolder.childFolder.length !== 0 ||
        bookmarkFolder.parent != null
      ) {
        return false;
      }

      return item.root !== root || item.level >= level;
    }

    if (
      item.parentFolder != null &&
      item.parentFolder._id === bookmarkFolder._id
    ) {
      return false;
    }
    return true;
  };

  const triangleBtnClassName = (
    isOpen: boolean,
    childrenExists: boolean,
  ): string => {
    if (!childrenExists) {
      return 'grw-foldertree-triangle-btn btn px-0 opacity-25';
    }
    return `grw-foldertree-triangle-btn btn px-0 ${isOpen ? 'grw-foldertree-open' : ''}`;
  };

  const renderChildFolder = () => {
    return (
      isOpen &&
      childFolder?.map((childFolder) => {
        return (
          <div key={childFolder._id} className="grw-foldertree-item-children">
            <BookmarkFolderItem
              key={childFolder._id}
              isReadOnlyUser={isReadOnlyUser}
              isOperable={props.isOperable}
              bookmarkFolder={childFolder}
              level={level + 1}
              root={root}
              isUserHomepage={isUserHomepage}
              onClickDeleteMenuItemHandler={onClickDeleteMenuItemHandler}
              bookmarkFolderTreeMutation={bookmarkFolderTreeMutation}
            />
          </div>
        );
      })
    );
  };

  const renderBookmarkItem = () => {
    return (
      isOpen &&
      bookmarks?.map((bookmark) => {
        return (
          <BookmarkItem
            key={bookmark._id}
            isReadOnlyUser={isReadOnlyUser}
            isOperable={props.isOperable}
            bookmarkedPage={bookmark.page}
            level={level + 1}
            parentFolder={bookmarkFolder}
            canMoveToRoot
            onClickDeleteMenuItemHandler={onClickDeleteMenuItemHandler}
            bookmarkFolderTreeMutation={bookmarkFolderTreeMutation}
          />
        );
      })
    );
  };

  const onClickRenameHandler = useCallback(() => {
    setIsRenameAction(true);
  }, []);

  const onClickDeleteHandler = useCallback(() => {
    const bookmarkFolderDeleteHandler: onDeletedBookmarkFolderFunction = (
      folderId,
    ) => {
      if (typeof folderId !== 'string') {
        return;
      }
      bookmarkFolderTreeMutation();
    };

    if (bookmarkFolder == null) {
      return;
    }
    openDeleteBookmarkFolderModal(bookmarkFolder, {
      onDeleted: bookmarkFolderDeleteHandler,
    });
  }, [
    bookmarkFolder,
    bookmarkFolderTreeMutation,
    openDeleteBookmarkFolderModal,
  ]);

  const onClickMoveToRootHandlerForBookmarkFolderItemControl =
    useCallback(async () => {
      try {
        await updateBookmarkFolder(
          bookmarkFolder._id,
          bookmarkFolder.name,
          null,
          bookmarkFolder.childFolder,
        );
        bookmarkFolderTreeMutation();
      } catch (err) {
        toastError(err);
      }
    }, [
      bookmarkFolder._id,
      bookmarkFolder.childFolder,
      bookmarkFolder.name,
      bookmarkFolderTreeMutation,
    ]);
  return (
    <div
      id={`grw-bookmark-folder-item-${folderId}`}
      className="grw-foldertree-item-container"
    >
      <DragAndDropWrapper
        key={folderId}
        type={acceptedTypes}
        item={props}
        useDragMode={isOperable}
        useDropMode={isOperable}
        onDropItem={itemDropHandler}
        isDropable={isDropable}
      >
        <li
          className="list-group-item list-group-item-action border-0 py-2 d-flex align-items-center rounded-1"
          style={{ paddingLeft }}
        >
          {isRenameAction ? (
            <div className="flex-fill">
              <BookmarkFolderNameInput
                value={name}
                onSubmit={rename}
                onCancel={cancel}
              />
            </div>
          ) : (
            <button
              type="button"
              className="d-flex align-items-center flex-fill border-0 bg-transparent p-0 text-start"
              onClick={loadChildFolder}
            >
              <div className="grw-triangle-container d-flex justify-content-center">
                <span className={triangleBtnClassName(isOpen, childrenExists)}>
                  <span className="material-symbols-outlined fs-5">
                    arrow_right
                  </span>
                </span>
              </div>
              <div>
                <FolderIcon isOpen={isOpen} />
              </div>
              <div className="grw-foldertree-title-anchor ps-1">
                <p className="text-truncate m-auto">{name}</p>
              </div>
            </button>
          )}
          {isOperable && (
            <div className="grw-foldertree-control d-flex">
              <BookmarkFolderItemControl
                onClickRename={onClickRenameHandler}
                onClickDelete={onClickDeleteHandler}
                onClickMoveToRoot={
                  bookmarkFolder.parent != null
                    ? onClickMoveToRootHandlerForBookmarkFolderItemControl
                    : undefined
                }
              >
                <DropdownToggle
                  color="transparent"
                  className="border-0 rounded btn-page-item-control p-0 grw-visible-on-hover me-1"
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                >
                  <span className="material-symbols-outlined">more_vert</span>
                </DropdownToggle>
              </BookmarkFolderItemControl>
              {/* Maximum folder hierarchy of 2 levels */}
              {!(bookmarkFolder.parent != null) && (
                <button
                  id="create-bookmark-folder-button"
                  type="button"
                  className="border-0 rounded btn btn-page-item-control p-0 grw-visible-on-hover"
                  onClick={onClickPlusButton}
                >
                  <span className="material-symbols-outlined">add_circle</span>
                </button>
              )}
            </div>
          )}
        </li>
      </DragAndDropWrapper>
      {isCreateAction && (
        <BookmarkFolderNameInput onSubmit={create} onCancel={cancel} />
      )}
      {renderChildFolder()}
      {renderBookmarkItem()}
    </div>
  );
};
