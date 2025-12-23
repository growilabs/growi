import React, {
  useEffect, useMemo, useRef, type JSX,
} from 'react';

import type { IRevisionHasId } from '@growi/core';
import { pagePathUtils } from '@growi/core/dist/utils';
import { useTranslation } from 'next-i18next';
import dynamic from 'next/dynamic';
import { debounce } from 'throttle-debounce';

import { useCurrentUser } from '~/states/global';
import { useIsTrashPage } from '~/states/page';
import { useSWRxPageComment } from '~/stores/comment';
import { useSWRMUTxPageInfo } from '~/stores/page';


const { isTopPage } = pagePathUtils;


const PageComment = dynamic(() => import('~/client/components/PageComment').then(mod => mod.PageComment), { ssr: false });
const CommentEditorPre = dynamic(() => import('./PageComment/CommentEditor').then(mod => mod.CommentEditorPre), { ssr: false });

type CommentsProps = {
  pageId: string,
  pagePath: string,
  revision: IRevisionHasId,
  onLoaded?: () => void,
}

export const Comments = (props: CommentsProps): JSX.Element => {

  const {
    pageId, pagePath, revision, onLoaded,
  } = props;

  const { t } = useTranslation('');

  const { mutate } = useSWRxPageComment(pageId);
  const { trigger: mutatePageInfo } = useSWRMUTxPageInfo(pageId);
  const isDeleted = useIsTrashPage();
  const currentUser = useCurrentUser();

  const pageCommentParentRef = useRef<HTMLDivElement>(null);

  const onLoadedDebounced = useMemo(() => debounce(500, () => onLoaded?.()), [onLoaded]);

  useEffect(() => {
    const parent = pageCommentParentRef.current;
    if (parent == null) return;

    const observer = new MutationObserver(() => {
      onLoadedDebounced();
    });
    observer.observe(parent, { childList: true, subtree: true });

    // no cleanup function -- 2023.07.31 Yuki Takei
    // see: https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/observe
    // > You can call observe() multiple times on the same MutationObserver
    // > to watch for changes to different parts of the DOM tree and/or different types of changes.
  }, [onLoadedDebounced]);

  const isTopPagePath = isTopPage(pagePath);

  if (pageId == null || isTopPagePath) {
    return <></>;
  }

  const onCommentButtonClickHandler = () => {
    mutate();
    mutatePageInfo();
  };

  return (
    <div className="page-comments-row mt-5 py-4 border-top d-edit-none d-print-none">
      <h4 className="mb-3">{t('page_comment.comments')}</h4>
      <div id="page-comments-list" className="page-comments-list" ref={pageCommentParentRef}>
        <PageComment
          pageId={pageId}
          pagePath={pagePath}
          revision={revision}
          currentUser={currentUser}
          isReadOnly={false}
        />
      </div>
      {!isDeleted && (
        <div id="page-comment-write">
          <CommentEditorPre
            pageId={pageId}
            onCommented={onCommentButtonClickHandler}
            revisionId={revision._id}
          />
        </div>
      )}
    </div>
  );

};
