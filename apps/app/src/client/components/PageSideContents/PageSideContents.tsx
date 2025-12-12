import React, {
  Suspense,
  useCallback,
  useRef,
  type JSX,
} from 'react';

import type { IPagePopulatedToShowRevision } from '@growi/core';
import { isIPageInfoForOperation } from '@growi/core/dist/interfaces';
import { pagePathUtils } from '@growi/core/dist/utils';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'next-i18next';
import dynamic from 'next/dynamic';
import { scroller } from 'react-scroll';

import { useIsGuestUser, useIsReadOnlyUser } from '~/states/context';
import { showPageSideAuthorsAtom } from '~/states/server-configurations';
import { useDescendantsPageListModalActions } from '~/states/ui/modal/descendants-page-list';
import { useTagEditModalActions } from '~/states/ui/modal/tag-edit';
import { useIsAbleToShowTagLabel } from '~/states/ui/page-abilities';
import { useSWRxPageInfo, useSWRxTagsInfo } from '~/stores/page';

import { ContentLinkButtons } from '../ContentLinkButtons';
import { PageTagsSkeleton } from '../PageTags';
import TableOfContents from '../TableOfContents';

import { PageAccessoriesControl } from './PageAccessoriesControl';


const { isTopPage, isUsersHomepage, isTrashPage } = pagePathUtils;


const PageTags = dynamic(() => import('../PageTags').then(mod => mod.PageTags), {
  ssr: false,
  loading: PageTagsSkeleton,
});

const AuthorInfo = dynamic(() => import('~/client/components/AuthorInfo').then(mod => mod.AuthorInfo), { ssr: false });

type TagsProps = {
  pageId: string,
  revisionId: string,
}

const Tags = (props: TagsProps): JSX.Element => {
  const { pageId, revisionId } = props;

  const { data: tagsInfoData } = useSWRxTagsInfo(pageId, { suspense: true });

  const showTagLabel = useIsAbleToShowTagLabel();
  const isGuestUser = useIsGuestUser();
  const isReadOnlyUser = useIsReadOnlyUser();
  const { open: openTagEditModal } = useTagEditModalActions();

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


type PageSideContentsProps = {
  page: IPagePopulatedToShowRevision,
  isSharedUser?: boolean,
}

export const PageSideContents = (props: PageSideContentsProps): JSX.Element => {
  const { t } = useTranslation();

  const { open: openDescendantPageListModal } = useDescendantsPageListModalActions();

  const { page, isSharedUser } = props;

  const tagsRef = useRef<HTMLDivElement>(null);

  const { data: pageInfo } = useSWRxPageInfo(page._id);
  const showPageSideAuthors = useAtomValue(showPageSideAuthorsAtom);

  const {
    creator, lastUpdateUser, createdAt, updatedAt,
  } = page;

  const pagePath = page.path;
  const isTopPagePath = isTopPage(pagePath);
  const isUsersHomepagePath = isUsersHomepage(pagePath);
  const isTrash = isTrashPage(pagePath);

  return (
    <>
      {/* AuthorInfo */}
      {showPageSideAuthors && (
        <div className="d-none d-md-block page-meta border-bottom pb-2 ms-lg-3 mb-3">
          <AuthorInfo user={creator} date={createdAt} mode="create" locate="pageSide" />
          <AuthorInfo user={lastUpdateUser} date={updatedAt} mode="update" locate="pageSide" />
        </div>
      )}

      {/* Tags */}
      {page.revision != null && (
        <div ref={tagsRef}>
          <Suspense fallback={<PageTagsSkeleton />}>
            <Tags pageId={page._id} revisionId={page.revision._id} />
          </Suspense>
        </div>
      )}

      <div className=" d-flex flex-column gap-2">
        {/* Page list */}
        {!isSharedUser && (
          <div className="d-flex" data-testid="pageListButton">
            <PageAccessoriesControl
              icon={<span className="material-symbols-outlined">subject</span>}
              label={t('page_list')}
              // Do not display CountBadge if '/trash/*': https://github.com/growilabs/growi/pull/7600
              count={!isTrash && isIPageInfoForOperation(pageInfo) ? pageInfo.descendantCount : undefined}
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
              count={isIPageInfoForOperation(pageInfo) ? pageInfo.commentCount : undefined}
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
