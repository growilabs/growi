import type { IUserHasId } from '@growi/core';
import { UserPicture } from '@growi/ui/dist/components';
import React, { type JSX } from 'react';

import styles from './UserInfo.module.scss';

export type UserInfoProps = {
  author?: IUserHasId;
};

export const UserInfo = (props: UserInfoProps): JSX.Element => {
  const { author } = props;

  if (author == null || author.status === 4) {
    return <></>;
  }

  return (
    <div
      className={`${styles['grw-users-info']} grw-users-info d-flex align-items-center d-edit-none mb-5 pb-3 border-bottom`}
      data-testid="grw-users-info"
    >
      <UserPicture user={author} noTooltip noLink />
      <div className="users-meta">
        <h1 className="user-page-name">{author.name}</h1>
        <div className="user-page-meta mt-3 mb-0">
          <span className="user-page-username me-4">
            <span className="user-page-username me-4">
              <span className="material-symbols-outlined">person</span>
              {author.username}
            </span>
          </span>
          <span className="user-page-email me-2">
            <span className="material-symbols-outlined me-1">mail</span>
            {author.isEmailPublished ? author.email : '*****'}
          </span>
          {author.introduction && (
            <span className="user-page-introduction">
              {author.introduction}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
