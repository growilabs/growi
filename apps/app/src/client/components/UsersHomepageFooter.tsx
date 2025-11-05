import React, { useState, type JSX } from 'react';

import { useTranslation } from 'next-i18next';

import { RecentActivity } from '~/client/components/RecentActivity/RecentActivity';
import { RecentCreated } from '~/client/components/RecentCreated/RecentCreated';
import { useCurrentUser } from '~/stores-universal/context';

import { BookmarkFolderTree } from './Bookmarks/BookmarkFolderTree';

import styles from './UsersHomepageFooter.module.scss';

type UsersHomepageFooterProps = {
  creatorId: string;
};

export const UsersHomepageFooter = (props: UsersHomepageFooterProps): JSX.Element => {
  const { t } = useTranslation();
  const { creatorId } = props;
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const { data: currentUser } = useCurrentUser();
  const isOperable = currentUser?._id === creatorId;

  return (
    <div className={`container-lg user-page-footer py-5 ${styles['user-page-footer']}`}>
      <div className="grw-user-page-list-m d-edit-none">
        <h2 id="bookmarks-list" className="grw-user-page-header border-bottom pb-2 mb-3 d-flex">
          <span style={{ fontSize: '1.3em' }} className="material-symbols-outlined">bookmark</span>
          {t('user_home_page.bookmarks')}
          <span className="ms-auto ps-2 ">
            <button type="button" className={`btn btn-sm grw-expand-compress-btn ${isExpanded ? 'active' : ''}`} onClick={() => setIsExpanded(!isExpanded)}>
              {isExpanded ? <span className="material-symbols-outlined">expand</span> : <span className="material-symbols-outlined">compress</span>}
            </button>
          </span>
        </h2>
        {/* TODO: In bookmark folders v1, the button to create a new folder does not exist. The button should be included in the bookmark component. */}
        <div className={`${isExpanded ? `${styles['grw-bookarks-contents-expanded']}` : `${styles['grw-bookarks-contents-compressed']}`}`}>
          <BookmarkFolderTree isUserHomepage isOperable={isOperable} userId={creatorId} />
        </div>
      </div>
      <div className="grw-user-page-list-m mt-5 d-edit-none">
        <h2 id="recently-created-list" className="grw-user-page-header border-bottom pb-2 mb-3 d-flex">
          <span className="growi-custom-icons me-1">recently_created</span>
          {t('user_home_page.recently_created')}
        </h2>
        <div id="user-created-list" className={`page-list ${styles['page-list']}`}>
          <RecentCreated userId={creatorId} />
        </div>

        <h2 id="user-created-list" className="grw-user-page-header border-bottom pb-2 mb-3 d-flex">
          <span className="growi-custom-icons me-1">recently_created</span>
          {t('user_home_page.recent_activity')}
        </h2>
        <div id="user-created-list" className={`page-list ${styles['page-list']}`}>
          <RecentActivity userId={creatorId} />
        </div>
      </div>
    </div>
  );
};
