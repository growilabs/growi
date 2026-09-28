import type { FC, JSX } from 'react';
import React, { memo, useCallback, useMemo, useState } from 'react';
import type { IRevision, Ref } from '@growi/core';
import { getIdStringForRef, isPopulated } from '@growi/core';
import { UserPicture } from '@growi/ui/dist/components';
import { parseISO } from 'date-fns/parseISO';
import { useTranslation } from 'next-i18next';

import { apiPost } from '~/client/util/apiv1-client';
import { toastError } from '~/client/util/toastr';
import { InlineCommentItem } from '~/features/inline-comment/client/components/InlineCommentItem/InlineCommentItem';
import type { InlineCommentWithReplies } from '~/features/inline-comment/interfaces';
import type { RendererOptions } from '~/interfaces/renderer-options';
import { useSWRMUTxPageInfo } from '~/stores/page';
import { useCommentForCurrentPageOptions } from '~/stores/renderer';

import type {
  ICommentHasId,
  ICommentHasIdList,
} from '../../interfaces/comment';
import { useSWRxPageComment } from '../../stores/comment';
import { NotAvailableForGuest } from './NotAvailableForGuest';
import { NotAvailableIfReadOnlyUserNotAllowedToComment } from './NotAvailableForReadOnlyUser';
import { Comment } from './PageComment/Comment';
import { CommentEditor } from './PageComment/CommentEditor';
import { ReplyComments } from './PageComment/ReplyComments';

import styles from './PageComment.module.scss';

type PageCommentProps = {
  rendererOptions?: RendererOptions;
  pageId: string;
  pagePath: string;
  revision: Ref<IRevision>;
  currentUser: any;
  isReadOnly: boolean;
  /**
   * The page's inline comments together with the writers that revalidate
   * them, supplied by the caller: this component must not fetch them
   * itself, since `Comments` is also mounted by `ShareLinkPageView`, where
   * inline comments must never be requested. Bundled as one object because
   * they belong to one `useSWRxInlineComments` call, and omitted by callers
   * that show no inline comments (the share-link view, search-result preview).
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
     * to; returns `false` when the range no longer resolves so the caller
     * can surface that instead of scrolling to nothing.
     */
    scrollToRange: (commentId: string) => boolean;
  };
};

/**
 * One entry of the merged list. Replies are NOT entries — they stay nested
 * under their parent, as they were before the two lists were merged.
 */
type CommentListItem =
  | { kind: 'normal'; sortKey: number; comment: ICommentHasId }
  | { kind: 'inline'; sortKey: number; comment: InlineCommentWithReplies };

/**
 * `createdAt` is declared as `Date` on both comment interfaces but actually
 * arrives as an ISO string, because the value is whatever the API's JSON
 * carried (see the same workaround in `Comment.tsx`). Subtracting two strings
 * yields `NaN`, which would silently turn the sort into a no-op, so parse
 * before comparing.
 */
const toSortKey = (createdAt: Date | string): number =>
  (typeof createdAt === 'string' ? parseISO(createdAt) : createdAt).valueOf();

export const PageComment: FC<PageCommentProps> = memo(
  (props: PageCommentProps): JSX.Element => {
    const {
      rendererOptions: rendererOptionsByProps,
      pageId,
      pagePath,
      revision,
      currentUser,
      isReadOnly,
      inlineComments: inline,
    } = props;

    const { data: comments, mutate } = useSWRxPageComment(pageId);
    const { data: rendererOptionsForCurrentPage } =
      useCommentForCurrentPageOptions();

    const [showEditorIds, setShowEditorIds] = useState<Set<string>>(new Set());
    const { trigger: mutatePageInfo } = useSWRMUTxPageInfo(pageId);

    const { t } = useTranslation('');

    const commentsFromOldest = useMemo(
      () => (comments != null ? [...comments].reverse() : null),
      [comments],
    );
    const commentsExceptReply: ICommentHasIdList | undefined = useMemo(
      () => commentsFromOldest?.filter((comment) => comment.replyTo == null),
      [commentsFromOldest],
    );
    // Normal and inline comments interleaved by posting date, ascending.
    const items = useMemo<CommentListItem[]>(
      () =>
        [
          ...(commentsExceptReply ?? []).map(
            (comment): CommentListItem => ({
              kind: 'normal',
              sortKey: toSortKey(comment.createdAt),
              comment,
            }),
          ),
          ...(inline?.comments ?? []).map(
            (comment): CommentListItem => ({
              kind: 'inline',
              sortKey: toSortKey(comment.createdAt),
              comment,
            }),
          ),
        ].sort((a, b) => a.sortKey - b.sortKey),
      [commentsExceptReply, inline?.comments],
    );

    const allReplies = {};

    if (commentsFromOldest != null) {
      commentsFromOldest.forEach((comment) => {
        if (comment.replyTo != null) {
          allReplies[comment.replyTo] =
            allReplies[comment.replyTo] == null
              ? [comment]
              : [...allReplies[comment.replyTo], comment];
        }
      });
    }

    /**
     * Deletes one comment. Each list item asks for the confirmation itself
     * and calls this once the reader confirms, so there is no page-level
     * "which comment is being deleted" state any more (design.md:
     * 削除確認UIの共通化). The failure is reported twice on purpose: the toast
     * is the page-level notification, and the rethrow lets the item that
     * asked show the reason next to the comment it applies to.
     */
    const onDeleteConfirmed = useCallback(
      async (comment: ICommentHasId): Promise<void> => {
        try {
          await apiPost('/comments.remove', { comment_id: comment._id });
          mutate();
          mutatePageInfo();
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : (error as any).toString();
          toastError(message);
          throw error;
        }
      },
      [mutate, mutatePageInfo],
    );

    const removeShowEditorId = useCallback((commentId: string) => {
      setShowEditorIds((previousState) => {
        return new Set([...previousState].filter((id) => id !== commentId));
      });
    }, []);

    const onReplyButtonClickHandler = useCallback((commentId: string) => {
      setShowEditorIds(
        (previousState) => new Set([...previousState, commentId]),
      );
    }, []);

    const onCommentButtonClickHandler = useCallback(
      (commentId: string) => {
        removeShowEditorId(commentId);
        mutate();
        mutatePageInfo();
      },
      [removeShowEditorId, mutate, mutatePageInfo],
    );

    const rendererOptions =
      rendererOptionsByProps ?? rendererOptionsForCurrentPage;

    // Nothing to show when neither kind of comment is present. Note this is
    // checked on the merged list, not on the normal comments alone: a page
    // whose only comments are inline ones must still render the list.
    if (items.length === 0 || rendererOptions == null) {
      return <></>;
    }

    const revisionId = getIdStringForRef(revision);
    const revisionCreatedAt = isPopulated(revision)
      ? revision.createdAt
      : undefined;

    const commentElement = (comment: ICommentHasId) => (
      <Comment
        rendererOptions={rendererOptions}
        comment={comment}
        revisionId={revisionId}
        revisionCreatedAt={revisionCreatedAt as Date}
        currentUser={currentUser}
        isReadOnly={isReadOnly}
        pageId={pageId}
        pagePath={pagePath}
        onDeleteConfirmed={onDeleteConfirmed}
        onComment={mutate}
      />
    );

    const replyCommentsElement = (replyComments: ICommentHasIdList) => (
      <ReplyComments
        rendererOptions={rendererOptions}
        isReadOnly={isReadOnly}
        revisionId={revisionId}
        revisionCreatedAt={revisionCreatedAt as Date}
        currentUser={currentUser}
        replyList={replyComments}
        pageId={pageId}
        pagePath={pagePath}
        onDeleteConfirmed={onDeleteConfirmed}
        onComment={mutate}
      />
    );

    return (
      <div
        className={`${styles['page-comment-styles']} page-comments-row comment-list`}
      >
        <div className="page-comments">
          <div className="page-comments-list mb-3" id="page-comments-list">
            {items.map((item) => {
              // An inline comment brings its own box, quote and replies, so it
              // only needs the same thread wrapper the normal comments use.
              if (item.kind === 'inline') {
                // Unreachable: an inline item only exists when `inline` was
                // supplied. The guard is what lets TypeScript see that.
                if (inline == null) return null;

                return (
                  <div
                    key={`inline-${item.comment.id}`}
                    className="page-comment-thread mb-2"
                  >
                    <InlineCommentItem
                      comment={item.comment}
                      pagePath={pagePath}
                      rendererOptions={rendererOptions}
                      resolve={inline.resolve}
                      createReply={inline.createReply}
                      update={inline.update}
                      remove={inline.remove}
                      updateReply={inline.updateReply}
                      removeReply={inline.removeReply}
                      scrollToRange={inline.scrollToRange}
                    />
                  </div>
                );
              }

              const comment = item.comment;
              const defaultCommentThreadClasses = 'page-comment-thread mb-2';
              const hasReply: boolean = Object.keys(allReplies).includes(
                comment._id,
              );

              let commentThreadClasses = '';
              commentThreadClasses = hasReply
                ? `${defaultCommentThreadClasses} page-comment-thread-no-replies`
                : defaultCommentThreadClasses;

              return (
                <div
                  key={`normal-${comment._id}`}
                  className={commentThreadClasses}
                >
                  {/* Comment */}
                  {commentElement(comment)}
                  {/* Reply comments */}
                  {hasReply && replyCommentsElement(allReplies[comment._id])}

                  {!isReadOnly && !showEditorIds.has(comment._id) && (
                    // `mt-2` here (not relying on the preceding comment's own
                    // bottom margin) matches InlineCommentReplies.tsx's own
                    // reply-toggle wrapper: the comment above this button
                    // renders as `CommentCard`'s `.page-comment-main mb-2` in
                    // its normal state, but as bare `CommentEditor` (no
                    // margin at all) while being edited -- relying on that
                    // margin left this button stuck directly against the
                    // editor with no gap. A top margin on this wrapper is
                    // stable regardless of the preceding element's own state,
                    // and collapses harmlessly with the existing `mb-2` when
                    // not editing (both 0.5rem, so the gap is unchanged in
                    // the normal case) (user request, 2026-09-11).
                    <div className="d-flex flex-row-reverse mt-2">
                      <NotAvailableForGuest>
                        <NotAvailableIfReadOnlyUserNotAllowedToComment>
                          <button
                            type="button"
                            data-testid="comment-reply-button"
                            className="btn btn-secondary btn-comment-reply text-start w-100 ms-5"
                            onClick={() =>
                              onReplyButtonClickHandler(comment._id)
                            }
                          >
                            <UserPicture
                              user={currentUser}
                              noLink
                              noTooltip
                              className="me-2"
                            />
                            <span className="material-symbols-outlined me-1 fs-5 pb-1">
                              reply
                            </span>
                            <small>{t('page_comment.reply')}...</small>
                          </button>
                        </NotAvailableIfReadOnlyUserNotAllowedToComment>
                      </NotAvailableForGuest>
                    </div>
                  )}

                  {/* Editor to reply */}
                  {!isReadOnly && showEditorIds.has(comment._id) && (
                    <CommentEditor
                      pageId={pageId}
                      replyTo={comment._id}
                      onCanceled={() => {
                        removeShowEditorId(comment._id);
                      }}
                      onCommented={() =>
                        onCommentButtonClickHandler(comment._id)
                      }
                      revisionId={revisionId}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  },
);

PageComment.displayName = 'PageComment';
