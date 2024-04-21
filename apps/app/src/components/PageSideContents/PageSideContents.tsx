import React, { Suspense, useCallback, useRef } from 'react';

import type { IPagePopulatedToShowRevision } from '@growi/core';
import { getIdForRef, type IPageInfoForOperation } from '@growi/core';
import { pagePathUtils } from '@growi/core/dist/utils';
import { useTranslation } from 'next-i18next';
import dynamic from 'next/dynamic';
import { scroller } from 'react-scroll';

import { useIsGuestUser, useIsReadOnlyUser } from '~/stores/context';
import { useDescendantsPageListModal, useTagEditModal } from '~/stores/modal';
import { useSWRxPageInfo, useSWRxTagsInfo } from '~/stores/page';
import { useIsAbleToShowTagLabel } from '~/stores/ui';

import { ContentLinkButtons } from '../ContentLinkButtons';
import { PageTagsSkeleton } from '../PageTags';
import TableOfContents from '../TableOfContents';

import { PageAccessoriesControl } from './PageAccessoriesControl';

import styles from './PageSideContents.module.scss';


const { isTopPage, isUsersHomepage, isTrashPage } = pagePathUtils;


const PageTags = dynamic(() => import('../PageTags').then(mod => mod.PageTags), {
  ssr: false,
  loading: PageTagsSkeleton,
});


type TagsProps = {
  pageId: string,
  revisionId: string,
}

const Tags = (props: TagsProps): JSX.Element => {
  const { pageId, revisionId } = props;

  const { data: tagsInfoData } = useSWRxTagsInfo(pageId, { suspense: true });

  const { data: showTagLabel } = useIsAbleToShowTagLabel();
  const { data: isGuestUser } = useIsGuestUser();
  const { data: isReadOnlyUser } = useIsReadOnlyUser();
  const { open: openTagEditModal } = useTagEditModal();

  const onClickEditTagsButton = useCallback(() => {
    if (tagsInfoData == null) {
      return;
    }
    openTagEditModal(tagsInfoData.tags, pageId, revisionId);
  }, [pageId, revisionId, tagsInfoData, openTagEditModal]);

  if (!showTagLabel || tagsInfoData == null) {
    return <></>;
  }

  const isTagLabelsDisabled = !!isGuestUser || !!isReadOnlyUser;

  return (
    <div className="grw-tag-labels-container">
      <PageTags
        tags={tagsInfoData.tags}
        isTagLabelsDisabled={isTagLabelsDisabled}
        onClickEditTagsButton={onClickEditTagsButton}
      />
    </div>
  );
};


export type PageSideContentsProps = {
  page: IPagePopulatedToShowRevision,
  isSharedUser?: boolean,
}

export const PageSideContents = (props: PageSideContentsProps): JSX.Element => {
  const { t } = useTranslation();

  const { open: openDescendantPageListModal } = useDescendantsPageListModal();

  const { page, isSharedUser } = props;

  const tagsRef = useRef<HTMLDivElement>(null);

  const { data: pageInfo } = useSWRxPageInfo(page._id);

  const pagePath = page.path;
  const isTopPagePath = isTopPage(pagePath);
  const isUsersHomepagePath = isUsersHomepage(pagePath);
  const isTrash = isTrashPage(pagePath);

  return (
    <>
      {/* Tags */}
      { page.revision != null && (
        <div ref={tagsRef}>
          <Suspense fallback={<PageTagsSkeleton />}>
            <Tags pageId={page._id} revisionId={page.revision._id} />
          </Suspense>
        </div>
      ) }

      <div className={`${styles['grw-page-accessories-controls']} d-flex flex-column gap-2`}>
        {/* Page list */}
        {!isSharedUser && (
          <div className="d-flex" data-testid="pageListButton">
            <PageAccessoriesControl
              icon={<span className="material-symbols-outlined">subject</span>}
              label={t('page_list')}
              // Do not display CountBadge if '/trash/*': https://github.com/weseek/growi/pull/7600
              count={!isTrash && pageInfo != null ? (pageInfo as IPageInfoForOperation).descendantCount : undefined}
              offset={1}
              onClick={() => openDescendantPageListModal(pagePath)}
            />
          </div>
        )}

        {/* Comments */}
        {!isTopPagePath && (
          <div className="d-flex" data-testid="page-comment-button">
            <PageAccessoriesControl
              icon={<span className="material-symbols-outlined">chat</span>}
              label={t('comments')}
              count={pageInfo != null ? (pageInfo as IPageInfoForOperation).commentCount : undefined}
              onClick={() => scroller.scrollTo('comments-container', { smooth: false, offset: -120 })}
            />
          </div>
        )}
      </div>

      <div className="d-none d-xl-block">
        <TableOfContents tagsElementHeight={tagsRef.current?.clientHeight} />
        {isUsersHomepagePath && <ContentLinkButtons author={page?.creator} />}
      </div>
    </>
  );
};
