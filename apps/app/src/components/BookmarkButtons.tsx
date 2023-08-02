import React, {
  FC, useState, useCallback,
} from 'react';

import { useTranslation } from 'next-i18next';
import DropdownToggle from 'reactstrap/es/DropdownToggle';
import Popover from 'reactstrap/es/Popover';
import PopoverBody from 'reactstrap/es/PopoverBody';
import UncontrolledTooltip from 'reactstrap/es/UncontrolledTooltip';

import { useSWRxBookmarkedUsers } from '~/stores/bookmark';
import { useIsGuestUser } from '~/stores/context';

import { BookmarkFolderMenu } from './Bookmarks/BookmarkFolderMenu';
import UserPictureList from './User/UserPictureList';

import styles from './BookmarkButtons.module.scss';

interface Props {
  pageId: string,
  isBookmarked?: boolean,
  bookmarkCount: number,
  hideTotalNumber?: boolean,
}

export const BookmarkButtons: FC<Props> = (props: Props) => {
  const { t } = useTranslation();
  const {
    pageId, isBookmarked, bookmarkCount, hideTotalNumber,
  } = props;

  const [isBookmarkFolderMenuOpen, setBookmarkFolderMenuOpen] = useState(false);
  const [isBookmarkUsersPopoverOpen, setBookmarkUsersPopoverOpen] = useState(false);

  const { data: isGuestUser } = useIsGuestUser();

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
        isOpen={isBookmarkFolderMenuOpen} pageId={pageId} isBookmarked={isBookmarked ?? false}
        onToggle={toggleBookmarkFolderMenuHandler}
        onUnbookmark={unbookmarkHandler}
      >
        <DropdownToggle id='bookmark-dropdown-btn' color="transparent" className={`shadow-none btn btn-bookmark border-0
          ${isBookmarked ? 'active' : ''} ${isGuestUser ? 'disabled' : ''}`}>
          <i className={`fa ${isBookmarked ? 'fa-bookmark' : 'fa-bookmark-o'}`}></i>
        </DropdownToggle>
      </BookmarkFolderMenu>
      <UncontrolledTooltip placement="top" data-testid="bookmark-button-tooltip" target="bookmark-dropdown-btn" fade={false}>
        {t(getTooltipMessage())}
      </UncontrolledTooltip>

      { !hideTotalNumber && (
        <>
          <button
            type="button"
            id="po-total-bookmarks"
            className={`shadow-none btn btn-bookmark border-0
              total-bookmarks ${isBookmarked ? 'active' : ''}`}
          >
            {bookmarkCount}
          </button>
          <Popover placement="bottom" isOpen={isBookmarkUsersPopoverOpen} target="po-total-bookmarks" toggle={toggleBookmarkUsersPopover} trigger="legacy">
            <PopoverBody className="user-list-popover">
              { isLoadingBookmarkedUsers && <i className="fa fa-spinner fa-pulse"></i> }
              { !isLoadingBookmarkedUsers && bookmarkedUsers != null && (
                <>
                  { bookmarkedUsers.length > 0
                    ? (
                      <div className="px-2 text-right user-list-content text-truncate text-muted">
                        <UserPictureList users={bookmarkedUsers} />
                      </div>
                    )
                    : t('No users have bookmarked yet')
                  }
                </>
              ) }
            </PopoverBody>
          </Popover>
        </>
      ) }
    </div>
  );
};
