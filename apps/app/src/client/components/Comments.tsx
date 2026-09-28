import { type JSX, useEffect, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import type { IRevisionHasId } from '@growi/core';
import { pagePathUtils } from '@growi/core/dist/utils';
import { useTranslation } from 'next-i18next';
import { debounce } from 'throttle-debounce';

import type { InlineCommentWithReplies } from '~/features/inline-comment/interfaces';
import { useCurrentUser } from '~/states/global';
import { useIsTrashPage } from '~/states/page';
import { useSWRxPageComment } from '~/stores/comment';
import { useSWRMUTxPageInfo } from '~/stores/page';

const { isTopPage } = pagePathUtils;

const PageComment = dynamic(
  () =>
    import('~/client/components/PageComment').then((mod) => mod.PageComment),
  { ssr: false },
);
const CommentEditorPre = dynamic(
  () =>
    import('./PageComment/CommentEditor').then((mod) => mod.CommentEditorPre),
  { ssr: false },
);

type CommentsProps = {
  pageId: string;
  pagePath: string;
  revision: IRevisionHasId;
  isReadOnly?: boolean;
  onLoaded?: () => void;
  /**
   * Forwarded to `PageComment` unchanged: this is the caller's
   * `useSWRxInlineComments` result bundled with `resolve`/`createReply`, not
   * a plain array. `Comments` must not default a missing value to an empty
   * list -- that would fabricate a "no inline comments" object without the
   * accompanying callbacks.
   */
  inlineComments?: {
    comments: InlineCommentWithReplies[];
    resolve: (id: string, resolved: boolean) => Promise<unknown>;
    createReply: (parentId: string, comment: string) => Promise<unknown>;
    /** Persists an edited origin-comment body. */
    update: (id: string, comment: string) => Promise<unknown>;
    /** Deletes the origin comment, along with its replies. */
    remove: (id: string) => Promise<unknown>;
    /** Persists an edited reply body. */
    updateReply: (id: string, comment: string) => Promise<unknown>;
    /** Deletes a single reply. */
    removeReply: (id: string) => Promise<unknown>;
    /**
     * Scrolls the page body to the highlighted range this comment anchors
     * to; returns `false` when the range no longer resolves. Passed
     * straight through to `PageComment` unchanged.
     */
    scrollToRange: (commentId: string) => boolean;
  };
};

export const Comments = (props: CommentsProps): JSX.Element => {
  const {
    pageId,
    pagePath,
    revision,
    isReadOnly = false,
    onLoaded,
    inlineComments,
  } = props;

  const { t } = useTranslation('');

  const { data: comments, mutate } = useSWRxPageComment(pageId);
  const { trigger: mutatePageInfo } = useSWRMUTxPageInfo(pageId);
  const isDeleted = useIsTrashPage();
  const currentUser = useCurrentUser();

  const pageCommentParentRef = useRef<HTMLDivElement>(null);

  const onLoadedDebounced = useMemo(
    () => debounce(500, () => onLoaded?.()),
    [onLoaded],
  );

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

  // On read-only views (e.g. share link page) the comment editor is hidden,
  // so an empty list would render just the heading with no body and look broken.
  // Show an explicit empty-state message instead.
  const hasNoComments = comments != null && comments.length === 0;

  const onCommentButtonClickHandler = () => {
    mutate();
    mutatePageInfo();
  };

  return (
    <div className="page-comments-row mt-5 py-4 border-top d-edit-none d-print-none">
      <h4 className="mb-3">{t('page_comment.comments')}</h4>
      <div
        id="page-comments-list"
        className="page-comments-list"
        ref={pageCommentParentRef}
      >
        <PageComment
          pageId={pageId}
          pagePath={pagePath}
          revision={revision}
          currentUser={currentUser}
          isReadOnly={isReadOnly}
          inlineComments={inlineComments}
        />
        {isReadOnly && hasNoComments && (
          <p className="text-muted mb-0" data-testid="comments-empty-state">
            {t('page_comment.no_comments')}
          </p>
        )}
      </div>
      {!isDeleted && !isReadOnly && (
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
