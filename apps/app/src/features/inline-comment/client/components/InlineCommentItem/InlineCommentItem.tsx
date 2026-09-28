/**
 * A single inline comment in the comment list. In its read-only display, the
 * box, header row, and body container all come from the shared
 * `CommentCard`, so an inline comment sits in exactly the same box as a
 * normal comment; only the parts that genuinely differ are supplied through
 * its slots (the resolved badge/toggle via `headerEnd`, the anchored quote
 * via `beforeBody`).
 *
 * While editing, `CommentCard` is not kept mounted underneath the editor --
 * it is replaced entirely by the bare `CommentEditor`, matching
 * `Comment.tsx`'s own re-edit exactly (user request: keeping the
 * box/header/quote/badge visible around a second, nested editor UI read as
 * redundant, not as an intentionally-kept feature). This means
 * the badge, resolve toggle, and quote are all hidden for the duration of an
 * edit, same as a normal comment's revision link and header disappear during
 * its own edit.
 *
 * `RevisionRenderer` receives `additionalClassName="comment"`, matching
 * `Comment.tsx`; without it, `Comment.module.scss`'s paragraph/blockquote
 * spacing (scoped to `.wiki.comment`) never reaches an inline comment.
 *
 * Edit/delete: shown only to the comment's own creator (`comment.creatorId
 * === currentUser?._id` — `creator` is not used for this check since it's
 * only ever populated by `listByPageId()`, and the popover cannot rely on a
 * populated `creator` either). The buttons themselves, and the read-only-user
 * gating around them, come from the shared `CommentEditDeleteButtons` --
 * the same component `CommentControl.tsx` uses for a normal comment.
 * Deleting opens the `DeleteConfirmAlert` shown in place, the same
 * confirmation a normal comment uses.
 */
import { type FC, type JSX, useState } from 'react';
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

import type { InlineCommentWithReplies } from '../../../interfaces';
import { InlineCommentReplies } from './InlineCommentReplies';

import styles from './InlineCommentItem.module.scss';

type InlineCommentItemProps = {
  comment: InlineCommentWithReplies;
  pagePath: string;
  /**
   * Undefined while the caller's renderer options are still loading — the
   * body then falls back to plain text rather than blocking the whole list
   * on the renderer-options fetch.
   */
  rendererOptions: RendererOptions | undefined;
  resolve: (id: string, resolved: boolean) => Promise<unknown>;
  createReply: (parentId: string, comment: string) => Promise<unknown>;
  /** Persists an edited origin-comment body. */
  update: (id: string, comment: string) => Promise<unknown>;
  /** Deletes the origin comment, along with its replies. */
  remove: (id: string) => Promise<unknown>;
  /** Persists an edited reply body, forwarded to `InlineCommentReplies`. */
  updateReply: (id: string, comment: string) => Promise<unknown>;
  /** Deletes a single reply, forwarded to `InlineCommentReplies`. */
  removeReply: (id: string) => Promise<unknown>;
  /**
   * Scrolls the page body to the highlighted range this comment anchors to.
   * Wired to the anchored quote below; the boolean re-anchor-failure result
   * is handled entirely inside `scrollToRange` itself.
   */
  scrollToRange: (commentId: string) => boolean;
};

export const InlineCommentItem: FC<InlineCommentItemProps> = (
  props,
): JSX.Element => {
  const {
    comment,
    pagePath,
    rendererOptions,
    resolve,
    createReply,
    update,
    remove,
    updateReply,
    removeReply,
    scrollToRange,
  } = props;
  const { t } = useTranslation();
  const currentUser = useCurrentUser();

  const [resolveError, setResolveError] = useState<string>();
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const isResolved = comment.resolvedAt != null;
  const isOwnComment = currentUser?._id === comment.creatorId;

  // `opacity-75` is what makes a resolved comment recede, mirroring the
  // mockup's `.ic-item[data-resolved="true"] { opacity: .8 }`. Besides the
  // badge's wording/color and the toggle's wording, that fade is the only
  // thing the resolved state changes — the layout stays identical.
  const resolvedRootClassName = isResolved
    ? 'inline-comment-item-resolved opacity-75'
    : undefined;

  const handleResolveToggle = async (): Promise<void> => {
    try {
      await resolve(comment.id, !isResolved);
      setResolveError(undefined);
    } catch (err) {
      setResolveError(
        err instanceof Error
          ? err.message
          : 'An unknown error occurred when updating the resolved status',
      );
    }
  };

  const handleQuoteClick = (): void => {
    scrollToRange(comment.id);
  };

  const handleEditCancel = (): void => {
    setIsEditing(false);
  };

  const handleDeleteConfirm = async (): Promise<void> => {
    try {
      await remove(comment.id);
      setDeleteError(undefined);
    } catch (err) {
      setDeleteError(
        err instanceof Error
          ? err.message
          : 'An unknown error occurred when deleting the comment',
      );
    } finally {
      setIsDeleteConfirmOpen(false);
    }
  };

  return (
    <div
      data-testid="inline-comment-item"
      data-resolved={isResolved}
      className={`inline-comment-item mb-3 ${styles['inline-comment-item-styles']}`}
    >
      {isEditing ? (
        // Matches `Comment.tsx`'s own re-edit -- the whole `CommentCard`
        // (box, header, quote, badge, resolve toggle)
        // is replaced by the bare `CommentEditor` while editing, not kept
        // mounted underneath it. `onSubmit` overrides `CommentEditor`'s
        // default post/update path to route through this comment's own
        // `update`, the same override technique `InlineCommentReplies.tsx`'s
        // reply composer already uses for `createReply`.
        <CommentEditor
          pageId={comment.pageId}
          currentCommentId={comment.id}
          commentBody={comment.comment}
          revisionId={comment.anchorOriginRevisionId}
          onCanceled={handleEditCancel}
          onCommented={() => setIsEditing(false)}
          onSubmit={(text) => update(comment.id, text)}
        />
      ) : (
        <CommentCard
          id={comment.id}
          creator={comment.creator}
          createdAt={comment.createdAt}
          rootClassName={resolvedRootClassName}
          headerEnd={
            <>
              {/* Same position as a normal comment's own history link:
                  right after the date, not part of the `ms-auto` group
                  below. */}
              <span className={`ms-2 ${styles['icon-button-container']}`}>
                <CommentRevisionLink
                  id={comment.id}
                  pagePath={pagePath}
                  pageId={comment.pageId}
                  revisionId={comment.anchorOriginRevisionId}
                />
              </span>
              {/* 2026-09-11 (user request): order left-to-right is
                  edit/delete, resolve/reopen, then the status badge, so the
                  badge sits at the row's very corner. The resolve/reopen
                  button now shares `.icon-button-container` with
                  edit/delete, hover-revealed the same way -- previously
                  always visible, inconsistent with edit/delete's
                  hover-reveal right next to it. The badge stays outside
                  `.icon-button-container` and always visible, since it is
                  the item's own status, not an action button. */}
              <span className="ms-auto d-flex align-items-center gap-2">
                {isOwnComment && !isDeleteConfirmOpen && (
                  <span
                    className={`d-flex align-items-center gap-1 ${styles['icon-button-container']}`}
                  >
                    <CommentEditDeleteButtons
                      testIdPrefix="inline-comment"
                      onClickEditBtn={() => setIsEditing(true)}
                      onClickDeleteBtn={() => setIsDeleteConfirmOpen(true)}
                    />
                  </span>
                )}
                <span className={styles['icon-button-container']}>
                  <NotAvailableIfReadOnlyUserNotAllowedToComment>
                    <button
                      type="button"
                      data-testid="inline-comment-resolve-toggle-button"
                      className="btn btn-sm btn-outline-secondary rounded-pill"
                      onClick={handleResolveToggle}
                    >
                      {isResolved
                        ? t('inline_comment.reopen')
                        : t('inline_comment.resolve')}
                    </button>
                  </NotAvailableIfReadOnlyUserNotAllowedToComment>
                </span>
                <span
                  data-testid="inline-comment-status"
                  className={`badge rounded-pill ${styles['inline-comment-status-badge']} ${
                    isResolved
                      ? 'bg-success-subtle text-success-emphasis'
                      : 'bg-warning-subtle text-warning-emphasis'
                  }`}
                >
                  {isResolved
                    ? t('inline_comment.resolved')
                    : t('inline_comment.unresolved')}
                </span>
              </span>
            </>
          }
          beforeBody={
            <>
              {/* `inline-comment-quote` is `:global(...)` in the CSS module, so it's
                  referenced as a plain class name -- styles['inline-comment-quote']
                  would be undefined. A real <button> (not a div with role="button")
                  wraps the quote for default keyboard accessibility, reset to
                  plain-text styling so it still reads as the quote. */}
              <button
                type="button"
                className="btn p-0 border-0 bg-transparent text-start w-100"
                onClick={handleQuoteClick}
              >
                <blockquote className="inline-comment-quote bg-body-tertiary rounded-end small text-body-secondary my-2 p-2">
                  {comment.anchor.quote}
                </blockquote>
              </button>
            </>
          }
          footer={
            <>
              {resolveError != null && (
                <span
                  className="text-danger d-block"
                  data-testid="inline-comment-resolve-error"
                >
                  {resolveError}
                </span>
              )}
              {deleteError != null && (
                <span
                  className="text-danger d-block"
                  data-testid="inline-comment-delete-error"
                >
                  {deleteError}
                </span>
              )}
              {isDeleteConfirmOpen && (
                <DeleteConfirmAlert
                  testIdPrefix="inline-comment"
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
              markdown={comment.comment}
              additionalClassName="comment"
            />
          ) : (
            <span>{comment.comment}</span>
          )}
        </CommentCard>
      )}

      <InlineCommentReplies
        parentId={comment.id}
        pagePath={pagePath}
        pageId={comment.pageId}
        revisionId={comment.anchorOriginRevisionId}
        replies={comment.replies}
        rendererOptions={rendererOptions}
        onSubmitReply={createReply}
        updateReply={updateReply}
        removeReply={removeReply}
      />
    </div>
  );
};
