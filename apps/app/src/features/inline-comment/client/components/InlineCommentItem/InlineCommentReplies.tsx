/**
 * Nested reply list + reply composer for an inline comment thread.
 *
 * Reuses the page-bottom `CommentEditor`, with `onSubmit` overridden to
 * route through this thread's own `createReply`.
 *
 * `reply.creatorId` (not the populated `creator`) decides reply ownership,
 * matching `InlineCommentItem`.
 *
 * Edit/delete buttons and the revision-history link both import
 * `InlineCommentItem.module.scss`'s `.icon-button-container` class (rather
 * than duplicating it) so its hover-reveal rule, scoped to each reply's own
 * `.page-comment-main`, reaches them too.
 *
 * The revision link uses the same `revisionId` as the origin comment, since
 * a reply has no anchor/revision of its own, and is shown to every viewer
 * (unlike edit/delete), so it sits outside the `isOwnReply` check.
 */

import { type FC, type JSX, useMemo, useState } from 'react';
import { UserPicture } from '@growi/ui/dist/components';
import { useTranslation } from 'react-i18next';

import { NotAvailableIfReadOnlyUserNotAllowedToComment } from '~/client/components/NotAvailableForReadOnlyUser';
import { CommentCard } from '~/client/components/PageComment/CommentCard';
import { CommentEditDeleteButtons } from '~/client/components/PageComment/CommentEditDeleteButtons';
import { CommentEditor } from '~/client/components/PageComment/CommentEditor';
import { CommentRevisionLink } from '~/client/components/PageComment/CommentRevisionLink';
import { DeleteConfirmAlert } from '~/client/components/PageComment/DeleteConfirmAlert';
import RevisionRenderer from '~/components/PageView/RevisionRenderer';
import type { RendererOptions } from '~/interfaces/renderer-options';
import { useCurrentUser } from '~/states/global';

import type { InlineCommentReply } from '../../../interfaces';

import styles from './InlineCommentItem.module.scss';

type InlineCommentRepliesProps = {
  parentId: string;
  pagePath: string;
  pageId: string;
  revisionId: string;
  replies: InlineCommentReply[];
  rendererOptions: RendererOptions | undefined;
  onSubmitReply: (parentId: string, comment: string) => Promise<unknown>;
  updateReply: (id: string, comment: string) => Promise<unknown>;
  removeReply: (id: string) => Promise<unknown>;
};

type InlineCommentReplyItemProps = {
  reply: InlineCommentReply;
  pagePath: string;
  pageId: string;
  revisionId: string;
  rendererOptions: RendererOptions | undefined;
  updateReply: (id: string, comment: string) => Promise<unknown>;
  removeReply: (id: string) => Promise<unknown>;
  isOwnReply: boolean;
};

const InlineCommentReplyItem: FC<InlineCommentReplyItemProps> = (
  props,
): JSX.Element => {
  const {
    reply,
    pagePath,
    pageId,
    revisionId,
    rendererOptions,
    updateReply,
    removeReply,
    isOwnReply,
  } = props;

  const [isEditing, setIsEditing] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();

  const handleEditCancel = (): void => {
    setIsEditing(false);
  };

  const handleDeleteConfirm = async (): Promise<void> => {
    try {
      await removeReply(reply.id);
      setDeleteError(undefined);
    } catch (err) {
      setDeleteError(
        err instanceof Error
          ? err.message
          : 'An unknown error occurred when deleting the reply',
      );
    } finally {
      setIsDeleteConfirmOpen(false);
    }
  };

  return (
    <div
      data-testid="inline-comment-reply"
      className="inline-comment-reply ms-4 ms-sm-5 mt-2"
    >
      {isEditing ? (
        // Matches the origin comment's own edit mode (see
        // `InlineCommentItem.tsx`) and `Comment.tsx`'s re-edit --
        // `CommentCard` is replaced entirely by the bare `CommentEditor`
        // while editing, not kept mounted underneath it. `onSubmit`
        // overrides the default post/update path to route through this
        // reply's own `updateReply`.
        <CommentEditor
          pageId={pageId}
          currentCommentId={reply.id}
          commentBody={reply.comment}
          revisionId={revisionId}
          onCanceled={handleEditCancel}
          onCommented={() => setIsEditing(false)}
          onSubmit={(text) => updateReply(reply.id, text)}
        />
      ) : (
        <CommentCard
          id={reply.id}
          creator={reply.creator}
          createdAt={reply.createdAt}
          headerEnd={
            <>
              {/* Shown to every viewer, unlike edit/delete below -- not
                  gated by `isOwnReply`. */}
              <span className={`ms-2 ${styles['icon-button-container']}`}>
                <CommentRevisionLink
                  id={reply.id}
                  pagePath={pagePath}
                  pageId={pageId}
                  revisionId={revisionId}
                />
              </span>
              {isOwnReply && !isDeleteConfirmOpen && (
                <span className="ms-auto d-flex align-items-center gap-2">
                  <span
                    className={`d-flex align-items-center gap-1 ${styles['icon-button-container']}`}
                  >
                    <CommentEditDeleteButtons
                      testIdPrefix="inline-comment-reply"
                      onClickEditBtn={() => setIsEditing(true)}
                      onClickDeleteBtn={() => setIsDeleteConfirmOpen(true)}
                    />
                  </span>
                </span>
              )}
            </>
          }
          footer={
            <>
              {deleteError != null && (
                <span
                  className="text-danger d-block"
                  data-testid="inline-comment-reply-delete-error"
                >
                  {deleteError}
                </span>
              )}
              {isDeleteConfirmOpen && (
                <DeleteConfirmAlert
                  testIdPrefix="inline-comment-reply"
                  onCancel={() => setIsDeleteConfirmOpen(false)}
                  onConfirm={handleDeleteConfirm}
                />
              )}
            </>
          }
        >
          {rendererOptions != null ? (
            <RevisionRenderer
              rendererOptions={rendererOptions}
              markdown={reply.comment}
            />
          ) : (
            <span>{reply.comment}</span>
          )}
        </CommentCard>
      )}
    </div>
  );
};

export const InlineCommentReplies: FC<InlineCommentRepliesProps> = (
  props,
): JSX.Element => {
  const {
    parentId,
    pagePath,
    pageId,
    revisionId,
    replies,
    rendererOptions,
    onSubmitReply,
    updateReply,
    removeReply,
  } = props;
  const { t } = useTranslation();
  const currentUser = useCurrentUser();

  const [isReplyOpen, setIsReplyOpen] = useState(false);

  const repliesFromOldest = useMemo(() => [...replies].reverse(), [replies]);

  return (
    <div
      data-testid="inline-comment-replies"
      className="inline-comment-replies"
    >
      {repliesFromOldest.map((reply) => (
        <InlineCommentReplyItem
          key={reply.id}
          reply={reply}
          pagePath={pagePath}
          pageId={pageId}
          revisionId={revisionId}
          rendererOptions={rendererOptions}
          updateReply={updateReply}
          removeReply={removeReply}
          isOwnReply={currentUser?._id === reply.creatorId}
        />
      ))}

      <div className="inline-comment-reply-form ms-4 ms-sm-5 mt-2">
        {isReplyOpen ? (
          <CommentEditor
            pageId={pageId}
            revisionId={revisionId}
            replyTo={parentId}
            onSubmit={(comment) => onSubmitReply(parentId, comment)}
            onCommented={() => setIsReplyOpen(false)}
            onCanceled={() => setIsReplyOpen(false)}
          />
        ) : (
          <NotAvailableIfReadOnlyUserNotAllowedToComment>
            <button
              type="button"
              data-testid="inline-comment-reply-toggle-button"
              // No `ms-5` here (unlike PageComment.tsx's reply toggle): the
              // indent is already applied by the wrapping `.inline-comment-reply-form`,
              // so adding it again would double the indent.
              className="btn btn-secondary btn-comment-reply text-start w-100"
              onClick={() => setIsReplyOpen(true)}
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
        )}
      </div>
    </div>
  );
};
