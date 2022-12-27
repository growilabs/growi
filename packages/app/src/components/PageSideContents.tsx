import React from 'react';

import { IPageHasId, pagePathUtils } from '@growi/core';
import { useTranslation } from 'next-i18next';
import { Link } from 'react-scroll';

import { DEFAULT_AUTO_SCROLL_OPTS } from '~/client/util/smooth-scroll';
import { useCurrentPathname } from '~/stores/context';
import { useDescendantsPageListModal } from '~/stores/modal';

import CountBadge from './Common/CountBadge';
import { ContentLinkButtons } from './ContentLinkButtons';
import PageListIcon from './Icons/PageListIcon';
import TableOfContents from './TableOfContents';

import styles from './PageSideContents.module.scss';


const { isTopPage, isUsersHomePage } = pagePathUtils;


export type PageSideContentsProps = {
  page?: IPageHasId,
  isSharedUser?: boolean,
}

export const PageSideContents = (props: PageSideContentsProps): JSX.Element => {
  const { t } = useTranslation();

  const { data: currentPathname } = useCurrentPathname();
  const { open: openDescendantPageListModal } = useDescendantsPageListModal();

  const { page, isSharedUser } = props;

  const pagePath = page?.path ?? currentPathname;
  const isTopPagePath = isTopPage(pagePath ?? '');
  const isUsersHomePagePath = isUsersHomePage(pagePath ?? '');

  return (
    <>
      {/* Page list */}
      <div className={`grw-page-accessories-control ${styles['grw-page-accessories-control']}`}>
        { pagePath != null && !isSharedUser && (
          <button
            type="button"
            className="btn btn-block btn-outline-secondary grw-btn-page-accessories rounded-pill d-flex justify-content-between align-items-center"
            onClick={() => openDescendantPageListModal(pagePath)}
            data-testid="pageListButton"
          >
            <div className="grw-page-accessories-control-icon">
              <PageListIcon />
            </div>
            {t('page_list')}
            <CountBadge count={page?.descendantCount} offset={1} />
          </button>
        ) }
      </div>

      {/* Comments */}
      { page != null && !isTopPagePath && (
        <div className={`mt-2 grw-page-accessories-control ${styles['grw-page-accessories-control']}`}>
          <Link to={'page-comments'} offset={-100} {...DEFAULT_AUTO_SCROLL_OPTS}>
            <button
              type="button"
              className="btn btn-block btn-outline-secondary grw-btn-page-accessories rounded-pill d-flex justify-content-between align-items-center"
            >
              <i className="icon-fw icon-bubbles grw-page-accessories-control-icon"></i>
              <span>Comments</span>
              <CountBadge count={page.commentCount} />
            </button>
          </Link>
        </div>
      ) }

      <div className="d-none d-lg-block">
        <TableOfContents />
        { isUsersHomePagePath && <ContentLinkButtons author={page?.creator} /> }
      </div>
    </>
  );
};
