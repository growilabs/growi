import type { IPageHasId } from '@growi/core';
import { pagePathUtils, templateChecker } from '@growi/core/dist/utils';
import type { FC, JSX } from 'react';

const { isTopPage } = pagePathUtils;
const { checkTemplatePath } = templateChecker;

const SEEN_USERS_HIDE_THRES__ACTIVE_USERS_COUNT = 5;
const MAX_STRENGTH_LEVEL = 4;

type SeenUsersCountProps = {
  count: number;
  basisViewersCount?: number;
  shouldSpaceOutIcon?: boolean;
};

const SeenUsersCount = (props: SeenUsersCountProps): JSX.Element => {
  const { count, shouldSpaceOutIcon, basisViewersCount } = props;

  if (count === 0) {
    // biome-ignore lint/complexity/noUselessFragments: ignore
    return <></>;
  }

  if (
    basisViewersCount != null &&
    basisViewersCount <= SEEN_USERS_HIDE_THRES__ACTIVE_USERS_COUNT
  ) {
    // biome-ignore lint/complexity/noUselessFragments: ignore
    return <></>;
  }

  const strengthLevel = Math.ceil(
    Math.min(0, Math.log(count / (basisViewersCount ?? count))) * // Max: 0
      2 *
      -1,
  );

  if (strengthLevel > MAX_STRENGTH_LEVEL) {
    // biome-ignore lint/complexity/noUselessFragments: ignore
    return <></>;
  }

  if (!(strengthLevel >= 0 && strengthLevel <= MAX_STRENGTH_LEVEL)) {
    throw new Error('strengthLevel out of range');
  } // [0, MAX_STRENGTH_LEVEL)

  const strengthClass = `strength-${strengthLevel}`; // strength-{0, 1, 2, 3, 4}

  return (
    <span
      className={`seen-users-count ${shouldSpaceOutIcon ? 'me-2' : ''} ${strengthClass}`}
    >
      <span className="material-symbols-outlined">footprint</span>
      {count}
    </span>
  );
};

type PageListMetaProps = {
  page: IPageHasId;
  likerCount?: number;
  bookmarkCount?: number;
  shouldSpaceOutIcon?: boolean;
  basisViewersCount?: number;
};

export const PageListMeta: FC<PageListMetaProps> = (
  props: PageListMetaProps,
) => {
  const { page, shouldSpaceOutIcon, basisViewersCount } = props;

  // top check
  let topLabel: JSX.Element | undefined;
  if (isTopPage(page.path)) {
    topLabel = (
      <span
        className={`badge bg-info ${shouldSpaceOutIcon ? 'me-2' : ''} top-label`}
      >
        TOP
      </span>
    );
  }

  // template check
  let templateLabel: JSX.Element | undefined;
  if (checkTemplatePath(page.path)) {
    templateLabel = (
      <span className={`badge bg-info ${shouldSpaceOutIcon ? 'me-2' : ''}`}>
        TMPL
      </span>
    );
  }

  let commentCount: JSX.Element | undefined;
  if (page.commentCount > 0) {
    commentCount = (
      <span className={`${shouldSpaceOutIcon ? 'me-2' : ''}`}>
        <span className="material-symbols-outlined">comment</span>
        {page.commentCount}
      </span>
    );
  }

  let likerCount: JSX.Element | undefined;
  if (props.likerCount != null && props.likerCount > 0) {
    likerCount = (
      <span className={`${shouldSpaceOutIcon ? 'me-2' : ''}`}>
        <span className="material-symbols-outlined">favorite</span>
        {props.likerCount}
      </span>
    );
  }

  let locked: JSX.Element | undefined;
  if (page.grant !== 1) {
    locked = (
      <span className={`${shouldSpaceOutIcon ? 'me-2' : ''}`}>
        <span className="material-symbols-outlined">lock</span>
      </span>
    );
  }

  let bookmarkCount: JSX.Element | undefined;
  if (props.bookmarkCount != null && props.bookmarkCount > 0) {
    bookmarkCount = (
      <span className={`${shouldSpaceOutIcon ? 'me-2' : ''}`}>
        <span className="material-symbols-outlined">bookmark</span>
        {props.bookmarkCount}
      </span>
    );
  }

  return (
    <span className="page-list-meta">
      {topLabel}
      {templateLabel}
      <SeenUsersCount
        count={page.seenUsers.length}
        basisViewersCount={basisViewersCount}
        shouldSpaceOutIcon={shouldSpaceOutIcon}
      />
      {commentCount}
      {likerCount}
      {locked}
      {bookmarkCount}
    </span>
  );
};
