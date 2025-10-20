import type { FC } from 'react';
import React, { useState, useCallback } from 'react';

import { LoadingSpinner } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';
import DropdownToggle from 'reactstrap/esm/DropdownToggle';
import Popover from 'reactstrap/esm/Popover';
import PopoverBody from 'reactstrap/esm/PopoverBody';
import UncontrolledTooltip from 'reactstrap/esm/UncontrolledTooltip';

import { useIsGuestUser } from '~/states/context';
import { useSWRxBookmarkedUsers } from '~/stores/bookmark';

import { BookmarkFolderMenu } from '../Bookmarks/BookmarkFolderMenu';
import UserPictureList from '../Common/UserPictureList';

import styles from './BookmarkButtons.module.scss';
import popoverStyles from './user-list-popover.module.scss';

interface Props {
  pageId: string,
  isBookmarked?: boolean,
  bookmarkCount: number,
}

export const BookmarkButtons: FC<Props> = (props: Props) => {
  const { t } = useTranslation();
  const {
    pageId, isBookmarked, bookmarkCount,
  } = props;

  const [isBookmarkFolderMenuOpen, setBookmarkFolderMenuOpen] = useState(false);
  const [isBookmarkUsersPopoverOpen, setBookmarkUsersPopoverOpen] = useState(false);

  const isGuestUser = useIsGuestUser();

  const { data: bookmarkedUsers, isLoading: isLoadingBookmarkedUsers } = useSWRxBookmarkedUsers(isBookmarkUsersPopoverOpen ? pageId : null);

  const unbookmarkHandler = () => {
    setBookmarkFolderMenuOpen(false);
  };

  const toggleBookmarkFolderMenuHandler = () => {
    setBookmarkFolderMenuOpen(v => !v);
  };

  const toggleBookmarkUsersPopover = () => {
    setBookmarkUsersPopoverOpen(v => !v);
  };

  const getTooltipMessage = useCallback(() => {

    if (isGuestUser) {
      return 'Not available for guest';
    }
    return 'tooltip.bookmark';
  }, [isGuestUser]);

  if (pageId == null) {
    return <></>;
  }

  return (
    <div className={`btn-group btn-group-bookmark ${styles['btn-group-bookmark']}`} role="group" aria-label="Bookmark buttons">

      <BookmarkFolderMenu
        isOpen={isBookmarkFolderMenuOpen}
        pageId={pageId}
        isBookmarked={isBookmarked ?? false}
        onToggle={toggleBookmarkFolderMenuHandler}
        onUnbookmark={unbookmarkHandler}
      >
        <DropdownToggle
          id="bookmark-dropdown-btn"
          color="transparent"
          className={`btn btn-bookmark rounded-end-0
          ${isBookmarked ? 'active' : ''} ${isGuestUser ? 'disabled' : ''}`}
        >
          <span className={`material-symbols-outlined ${isBookmarked ? 'fill' : ''}`}>
            bookmark
          </span>
        </DropdownToggle>
      </BookmarkFolderMenu>
      <UncontrolledTooltip data-testid="bookmark-button-tooltip" target="bookmark-dropdown-btn" fade={false}>
        {t(getTooltipMessage())}
      </UncontrolledTooltip>

      <button
        type="button"
        id="po-total-bookmarks"
        className={`btn btn-bookmark
          total-counts ${isBookmarked ? 'active' : ''}`}
      >
        {bookmarkCount}
      </button>
      <Popover placement="bottom" isOpen={isBookmarkUsersPopoverOpen} target="po-total-bookmarks" toggle={toggleBookmarkUsersPopover} trigger="legacy">
        <PopoverBody className={`user-list-popover ${popoverStyles['user-list-popover']}`}>
          { isLoadingBookmarkedUsers && <LoadingSpinner /> }
          { !isLoadingBookmarkedUsers && bookmarkedUsers != null && (
            <>
              { bookmarkedUsers.length > 0
                ? (
                  <div className="px-2 text-end user-list-content text-truncate text-muted">
                    <UserPictureList users={bookmarkedUsers} />
                  </div>
                )
                : t('No users have bookmarked yet')
              }
            </>
          ) }
        </PopoverBody>
      </Popover>
    </div>
  );
};
