import React, {
  useCallback, useMemo, useState, type JSX,
} from 'react';

import { useTranslation } from 'next-i18next';
import { DropdownItem, DropdownMenu, UncontrolledDropdown } from 'reactstrap';

import { addBookmarkToFolder, toggleBookmark } from '~/client/util/bookmark-utils';
import { toastError } from '~/client/util/toastr';
import { useCurrentUser } from '~/states/global';
import { useSWRMUTxCurrentUserBookmarks } from '~/stores/bookmark';
import { useSWRxBookmarkFolderAndChild } from '~/stores/bookmark-folder';
import { useSWRMUTxPageInfo } from '~/stores/page';

import { BookmarkFolderMenuItem } from './BookmarkFolderMenuItem';

import styles from './BookmarkFolderMenu.module.scss';

type BookmarkFolderMenuProps = {
  isOpen: boolean,
  pageId: string,
  isBookmarked: boolean,
  onToggle?: () => void,
  onUnbookmark?: () => void,
  children?: React.ReactNode,
}

export const BookmarkFolderMenu = (props: BookmarkFolderMenuProps): JSX.Element => {
  const {
    isOpen, pageId, isBookmarked, onToggle, onUnbookmark, children,
  } = props;

  const { t } = useTranslation();

  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  const currentUser = useCurrentUser();
  const { data: bookmarkFolders, mutate: mutateBookmarkFolders } = useSWRxBookmarkFolderAndChild(currentUser?._id);

  const { trigger: mutateCurrentUserBookmarks } = useSWRMUTxCurrentUserBookmarks();
  const { trigger: mutatePageInfo } = useSWRMUTxPageInfo(pageId);

  const isBookmarkFolderExists = useMemo((): boolean => {
    return bookmarkFolders != null && bookmarkFolders.length > 0;
  }, [bookmarkFolders]);

  const toggleBookmarkHandler = useCallback(async() => {
    try {
      await toggleBookmark(pageId, isBookmarked);
    }
    catch (err) {
      toastError(err);
    }
  }, [isBookmarked, pageId]);

  const onUnbookmarkHandler = useCallback(async() => {
    if (onUnbookmark != null) {
      onUnbookmark();
    }
    await toggleBookmarkHandler();
    setSelectedItem(null);
    mutateCurrentUserBookmarks();
    mutateBookmarkFolders();
    mutatePageInfo();
  }, [onUnbookmark, toggleBookmarkHandler, mutateCurrentUserBookmarks, mutateBookmarkFolders, mutatePageInfo]);

  const toggleHandler = useCallback(async() => {
    // on close
    if (isOpen && bookmarkFolders != null) {
      bookmarkFolders.forEach((bookmarkFolder) => {
        bookmarkFolder.bookmarks.forEach((bookmark) => {
          if (bookmark.page?._id === pageId) {
            setSelectedItem(bookmarkFolder._id);
          }
        });
      });
    }

    if (onToggle != null) {
      onToggle();
    }

    if (selectedItem == null) {
      setSelectedItem('root');
    }

    if (!isOpen && !isBookmarked) {
      try {
        await toggleBookmarkHandler();
        mutateCurrentUserBookmarks();
        mutatePageInfo();
      }
      catch (err) {
        toastError(err);
      }
    }
  },
  [isOpen, bookmarkFolders, onToggle, selectedItem, isBookmarked, pageId, toggleBookmarkHandler, mutateCurrentUserBookmarks, mutatePageInfo]);

  const onMenuItemClickHandler = useCallback(async(e, itemId: string) => {
    e.stopPropagation();

    setSelectedItem(itemId);

    try {
      await addBookmarkToFolder(pageId, itemId === 'root' ? null : itemId);
      mutateCurrentUserBookmarks();
      mutateBookmarkFolders();
      mutatePageInfo();
    }
    catch (err) {
      toastError(err);
    }
  }, [pageId, mutateCurrentUserBookmarks, mutateBookmarkFolders, mutatePageInfo]);

  const renderBookmarkMenuItem = () => {
    return (
      <>
        <DropdownItem
          toggle={false}
          onClick={onUnbookmarkHandler}
          className="grw-bookmark-folder-menu-item text-danger text-truncate"
        >
          <span className="material-symbols-outlined">bookmark</span>{' '}
          <span className="mx-2">
            {t('bookmark_folder.cancel_bookmark')}
          </span>
        </DropdownItem>

        {isBookmarkFolderExists && (
          <>
            <DropdownItem divider />
            <div key="root">
              <div
                className="dropdown-item grw-bookmark-folder-menu-item list-group-item list-group-item-action px-4"
                tabIndex={0}
                role="menuitem"
                onClick={e => onMenuItemClickHandler(e, 'root')}
              >
                <BookmarkFolderMenuItem
                  itemId="root"
                  itemName={t('bookmark_folder.root')}
                  isSelected={selectedItem === 'root'}
                />
              </div>
            </div>
            {bookmarkFolders?.map(folder => (
              <React.Fragment key={`bookmark-folders-${folder._id}`}>
                <div
                  className="dropdown-item grw-bookmark-folder-menu-item grw-bookmark-folder-menu-item-folder-first list-group-item list-group-item-action"
                  tabIndex={0}
                  role="menuitem"
                  onClick={e => onMenuItemClickHandler(e, folder._id)}
                >
                  <BookmarkFolderMenuItem
                    itemId={folder._id}
                    itemName={folder.name}
                    isSelected={selectedItem === folder._id}
                  />
                </div>
                {folder.childFolder?.map(child => (
                  <div key={child._id}>
                    <div
                      className="dropdown-item grw-bookmark-folder-menu-item grw-bookmark-folder-menu-item-folder-second list-group-item list-group-item-action"
                      tabIndex={0}
                      role="menuitem"
                      onClick={e => onMenuItemClickHandler(e, child._id)}
                    >
                      <BookmarkFolderMenuItem
                        itemId={child._id}
                        itemName={child.name}
                        isSelected={selectedItem === child._id}
                      />
                    </div>
                  </div>
                ))}
              </React.Fragment>
            ))}
          </>
        )}
      </>
    );
  };

  return (
    <UncontrolledDropdown
      isOpen={isOpen}
      onToggle={toggleHandler}
    >
      {children}

      { isOpen && (
        <DropdownMenu
          end
          persist
          strategy="fixed"
          container="body"
          className={`grw-bookmark-folder-menu ${styles['grw-bookmark-folder-menu']}`}
        >
          { renderBookmarkMenuItem() }
        </DropdownMenu>
      ) }
    </UncontrolledDropdown>
  );
};
