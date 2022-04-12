import React, { FC } from 'react';

import { IPageHasId } from '@growi/app/src/interfaces/page';
import { templateChecker, pagePathUtils } from '@growi/core';

import { FootstampIcon } from '../SearchPage/FootstampIcon';

const { isTopPage } = pagePathUtils;
const { checkTemplatePath } = templateChecker;

type PageListMetaProps = {
  page: IPageHasId,
  likerCount?: number,
  bookmarkCount?: number,
  shouldSpaceOutIcon?: boolean,
}

export const PageListMeta: FC<PageListMetaProps> = (props: PageListMetaProps) => {

  const { page, shouldSpaceOutIcon } = props;

  // top check
  let topLabel;
  if (isTopPage(page.path)) {
    topLabel = <span className={`badge badge-info ${shouldSpaceOutIcon ? 'mr-3' : ''} top-label`}>TOP</span>;
  }

  // template check
  let templateLabel;
  if (checkTemplatePath(page.path)) {
    templateLabel = <span className={`badge badge-info ${shouldSpaceOutIcon ? 'mr-3' : ''}`}>TMPL</span>;
  }

  let commentCount;
  if (page.commentCount > 0) {
    commentCount = <span className={`${shouldSpaceOutIcon ? 'mr-3' : ''}`}><i className="icon-bubble" />{page.commentCount}</span>;
  }

  let likerCount;
  if (props.likerCount != null && props.likerCount > 0) {
    likerCount = <span className={`${shouldSpaceOutIcon ? 'mr-3' : ''}`}><i className="fa fa-heart-o" />{props.likerCount}</span>;
  }

  let locked;
  if (page.grant !== 1) {
    locked = <span className={`${shouldSpaceOutIcon ? 'mr-3' : ''}`}><i className="icon-lock" /></span>;
  }

  let seenUserCount;
  if (page.seenUsers.length > 0) {
    seenUserCount = (
      <span className={`${shouldSpaceOutIcon ? 'mr-3' : ''}`}>
        <i className="footstamp-icon"><FootstampIcon /></i>
        {page.seenUsers.length}
      </span>
    );
  }

  let bookmarkCount;
  if (props.bookmarkCount != null && props.bookmarkCount > 0) {
    bookmarkCount = <span className={`${shouldSpaceOutIcon ? 'mr-3' : ''}`}><i className="fa fa-bookmark-o" />{props.bookmarkCount}</span>;
  }

  return (
    <span className="page-list-meta">
      {topLabel}
      {templateLabel}
      {seenUserCount}
      {commentCount}
      {likerCount}
      {locked}
      {bookmarkCount}
    </span>
  );

};
