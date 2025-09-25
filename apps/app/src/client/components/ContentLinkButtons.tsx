import React, { type JSX } from 'react';

import { USER_STATUS, type IUserHasId } from '@growi/core';
import { useTranslation } from 'next-i18next';
import { Link as ScrollLink } from 'react-scroll';

const BookMarkLinkButton = React.memo(() => {
  const { t } = useTranslation();
  return (
    <ScrollLink to="bookmarks-list" offset={-120}>
      <button
        type="button"
        className="btn btn-sm btn-outline-neutral-secondary rounded-pill d-flex align-items-center w-100 px-3"
      >
        <span className="material-symbols-outlined p-0 me-2">bookmark</span>
        <span>{t('user_home_page.bookmarks')}</span>
      </button>
    </ScrollLink>
  );
});

BookMarkLinkButton.displayName = 'BookMarkLinkButton';

const RecentlyCreatedLinkButton = React.memo(() => {
  const { t } = useTranslation();
  return (
    <ScrollLink to="recently-created-list" offset={-120}>
      <button
        type="button"
        className="btn btn-sm btn-outline-neutral-secondary rounded-pill d-flex align-items-center w-100 px-3"
      >
        <span className="growi-custom-icons mx-2 ">recently_created</span>
        <span>{t('user_home_page.recently_created')}</span>
      </button>
    </ScrollLink>
  );
});

RecentlyCreatedLinkButton.displayName = 'RecentlyCreatedLinkButton';


export type ContentLinkButtonsProps = {
  author?: IUserHasId,
}

export const ContentLinkButtons = (props: ContentLinkButtonsProps): JSX.Element => {
  const { author } = props;

  if (author == null || author.status === USER_STATUS.DELETED) {
    return <></>;
  }

  return (
    <div className="d-grid gap-2">
      <BookMarkLinkButton />
      <RecentlyCreatedLinkButton />
    </div>
  );
};
