/**
 * Content-preview + simple-reply popover shown when a saved inline-comment
 * highlight in the page body is hovered/clicked/tapped.
 *
 * Positioning follows the same building blocks `SelectionPopover` uses, but
 * `SelectionPopover` itself isn't reused as a wrapper: it has no
 * outside-click-to-close behavior, which this popover needs.
 *
 * The reply composer uses the same `MentionAwareCommentInput` +
 * `MentionPickerButton` pairing as every other comment input in this feature
 * (2026-09-11) — it used to be a
 * plain `<textarea>` that only borrowed the surrounding composer's visual
 * language, but that meant mention insertion had no shared implementation to
 * plug into here, so the pill-shaped one-line layout was dropped in favor of
 * the same boxed editor the edit forms already use.
 *
 * Every displayed comment — the origin and each reply — is an
 * `InlineCommentPopoverEntry`, this popover's own flat markup rather than the
 * shared `CommentCard`: the mockup draws them flat on the popover's surface,
 * while `CommentCard` brings the shared comment box (a gray fill, a
 * speech-bubble triangle, its own small avatar). The bottom-of-page list keeps
 * using `CommentCard`.
 *
 * Editing and deleting are offered only to an entry's own creator, gated by
 * the same read-only-user restriction `InlineCommentItem.tsx` applies. Each
 * entry owns its own edit / delete-confirmation state, which is why editing
 * one no longer hides the rest of the thread.
 */
import { type FC, type JSX, useEffect, useMemo, useRef, useState } from 'react';
import { UserPicture } from '@growi/ui/dist/components';
import type { VirtualElement } from '@popperjs/core';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { NotAvailableIfReadOnlyUserNotAllowedToComment } from '~/client/components/NotAvailableForReadOnlyUser';
import type { RendererOptions } from '~/interfaces/renderer-options';
import { useCurrentUser } from '~/states/global';

import type { InlineCommentWithReplies } from '../../../interfaces';
import { MentionPickerButton } from '../InlineCommentForm/MentionPickerButton';
import { MentionAwareCommentInput } from '../MentionAwareCommentInput/MentionAwareCommentInput';
import { useCommentInputControls } from '../MentionAwareCommentInput/use-comment-input-controls';
import { rangeToVirtualElement } from '../SelectionPopover/selection-virtual-element';
import { usePopperPosition } from '../SelectionPopover/use-popper-position';
import { InlineCommentPopoverEntry } from './InlineCommentPopoverEntry';

import styles from './InlineCommentPreviewPopover.module.scss';

type ReferenceRect = ReturnType<VirtualElement['getBoundingClientRect']>;

const isZeroRect = (rect: ReferenceRect): boolean =>
  rect.width === 0 && rect.height === 0;

type InlineCommentPreviewPopoverProps = {
  /** The origin comment (with its nested replies) to display. */
  comment: InlineCommentWithReplies;
  /** The range the popover is positioned against (the resolved highlight). */
  range: Range;
  /**
   * Undefined while the caller's renderer options are still loading -- the
   * body then falls back to plain text rather than blocking on the fetch.
   */
  rendererOptions: RendererOptions | undefined;
  createReply: (parentId: string, comment: string) => Promise<unknown>;
  /** Toggles the origin comment's resolved state. */
  resolve: (id: string, resolved: boolean) => Promise<unknown>;
  /** Persists an edited origin-comment body; same author-only/read-only-user gating as `InlineCommentItem.tsx`. */
  update: (id: string, comment: string) => Promise<unknown>;
  /** Deletes the origin comment and its whole thread (Requirement 2.6). */
  remove: (id: string) => Promise<unknown>;
  /** Persists an edited reply body. */
  updateReply: (id: string, comment: string) => Promise<unknown>;
  /** Deletes a single reply. */
  removeReply: (id: string) => Promise<unknown>;
  onClose: () => void;
  /** Fired once the pointer has actually arrived on the popover; the caller promotes a hover-shown popover into its pinned state on this signal. */
  onPointerEnter: () => void;
};

export const InlineCommentPreviewPopover: FC<
  InlineCommentPreviewPopoverProps
> = (props): JSX.Element | null => {
  const {
    comment,
    range,
    rendererOptions,
    createReply,
    resolve,
    update,
    remove,
    updateReply,
    removeReply,
    onClose,
    onPointerEnter,
  } = props;
  const { t } = useTranslation();
  const currentUser = useCurrentUser();
  const isOwnComment = currentUser?._id === comment.creatorId;

  // `comment.replies` arrives in the server's `createdAt: 'desc'` fetch order
  // (newest first) -- InlineCommentService.listByPageId() never reorders for
  // display. Reversed here to oldest-first (newest at the bottom), matching
  // both InlineCommentReplies.tsx's own `repliesFromOldest` and a normal
  // comment thread's reading order (2026-09-11, user report: replies were
  // rendering newest-first, oldest-last).
  const repliesFromOldest = useMemo(
    () => [...comment.replies].reverse(),
    [comment.replies],
  );

  // A state-backed callback ref (not useRef): `usePopperPosition` takes the
  // popper element as an effect dependency, and the same node also serves as
  // the outside-click boundary below.
  const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(
    null,
  );

  const lastValidRectRef = useRef<ReferenceRect | null>(null);

  const virtualElement = useMemo<VirtualElement>(() => {
    const rangeElement = rangeToVirtualElement(range);

    return {
      getBoundingClientRect: () => {
        const rect = rangeElement.getBoundingClientRect();

        if (isZeroRect(rect)) {
          return lastValidRectRef.current ?? rect;
        }

        lastValidRectRef.current = rect;
        return rect;
      },
    };
  }, [range]);

  usePopperPosition(virtualElement, popperElement);

  // A click/mousedown outside the popover closes it -- SelectionPopover has
  // no such behavior, so it's implemented directly here.
  useEffect(() => {
    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (
        popperElement != null &&
        target != null &&
        popperElement.contains(target)
      ) {
        return;
      }
      // The mention-completion popup (typing "@" inside any
      // MentionAwareCommentInput in this popover -- an edit form or the
      // reply composer) is portaled to document.body, outside popperElement,
      // exactly like InlineCommentForm.tsx's own outside-click guard has to
      // account for.
      if (
        target instanceof Element &&
        target.closest('.cm-tooltip-autocomplete') != null
      ) {
        return;
      }
      onClose();
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [popperElement, onClose]);

  const [resolveError, setResolveError] = useState<string>();
  const isResolved = comment.resolvedAt != null;

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

  // Deleting the origin comment leaves this popover with nothing to show, so
  // it closes itself instead of waiting for the refetch to drop the comment
  // from the caller's list (which would also clear it, but only after the
  // round trip). A rejection propagates past `onClose` so the entry's own
  // catch can render the error and keep the popover open.
  const handleOriginRemove = async (): Promise<void> => {
    await remove(comment.id);
    onClose();
  };

  // The reply composer is `MentionAwareCommentInput`, same as every other
  // comment input in this feature -- it owns its own draft text, submit
  // guard, and error display, and reports `{ canSubmit, submit,
  // insertMention }` outward for this component to render (same handshake
  // `InlineCommentForm.tsx` uses).
  const {
    canSubmit: canSubmitReply,
    submit: submitReply,
    insertMention: insertMentionIntoReply,
    onControlsChange: onReplyControlsChange,
  } = useCommentInputControls();
  const replyEditorKey = `inline_comment_preview_popover_new_reply_${comment.id}`;

  return createPortal(
    // zIndex 1070 mirrors SelectionPopover's own portal (Bootstrap's $zindex-popover).
    // biome-ignore lint/a11y/noStaticElementInteractions: not an interactive element -- onMouseEnter only reports "pointer arrived" so the caller can lock the popover open
    <div
      ref={setPopperElement}
      data-testid="inline-comment-preview-popover"
      style={{ zIndex: 1070 }}
      // `card` gives the mockup's own surface color and 1px border; the
      // corner radius and the diffuse drop shadow are its `--radius-lg`
      // (14px -> Bootstrap's 1rem `rounded-4`, the nearest step) and
      // `--shadow`, taken from Bootstrap's own scale rather than written as
      // hex/bespoke values (Requirement 3.1). The card treatment lives here,
      // on the popover itself, because the mockup puts the origin comment
      // flat on this surface instead of in a box of its own.
      className={`card rounded-4 shadow ${styles['inline-comment-preview-popover-styles']}`}
      onMouseEnter={onPointerEnter}
    >
      <div className="card-body">
        <div data-testid="inline-comment-preview-popover-origin">
          <InlineCommentPopoverEntry
            id={comment.id}
            creator={comment.creator}
            createdAt={comment.createdAt}
            commentText={comment.comment}
            rendererOptions={rendererOptions}
            isOwn={isOwnComment}
            editorKeyPrefix="inline_comment_preview_popover_edit"
            onUpdate={(text) => update(comment.id, text)}
            onRemove={handleOriginRemove}
            beforeBody={
              /* Same left-accent idiom as InlineCommentItem.tsx's quote, but
                 not a click target. The origin is the only entry with one. */
              <blockquote
                data-testid="inline-comment-preview-popover-quote"
                className={`inline-comment-quote bg-body-tertiary rounded-end small text-body-secondary mt-3 mb-0 p-2 ${styles['inline-comment-preview-popover-quote-clamp']}`}
              >
                {comment.anchor.quote}
              </blockquote>
            }
            headerExtra={
              <>
                {/* No status badge here: the
                    toggle's own label already says which way the state will
                    go, and the badge repeated that in the popover's tight
                    header row. The list item keeps its badge. */}
                {/* Read-only-user restriction (inline-comment-readonly-restriction
                    Requirement 2.3, 2.4) -- same guard the origin's
                    edit/delete controls above already use. Only this button
                    is wrapped, not the close button next to it: the close
                    control must stay reachable in every mode (see this
                    file's own header comment). */}
                <NotAvailableIfReadOnlyUserNotAllowedToComment>
                  <button
                    type="button"
                    data-testid="inline-comment-preview-popover-resolve-toggle-button"
                    className="btn btn-sm btn-outline-secondary rounded-pill"
                    onClick={handleResolveToggle}
                  >
                    {isResolved
                      ? t('inline_comment.reopen')
                      : t('inline_comment.resolve')}
                  </button>
                </NotAvailableIfReadOnlyUserNotAllowedToComment>
                {/* Last element of the header row, after the resolve toggle.
                    It used to be `position-absolute top-0 end-0` on the card
                    body, which put it above the header row in the card's own
                    top padding, where it visually collided with the popover's
                    rounded corner. */}
                <button
                  type="button"
                  data-testid="inline-comment-preview-popover-close-button"
                  className="btn-close"
                  aria-label={t('Close')}
                  onClick={onClose}
                />
              </>
            }
            testIdPrefix="inline-comment-preview-popover"
          />

          {/* Resolving is the origin's alone, so its error stays here rather
              than inside the shared entry. */}
          {resolveError != null && (
            <span
              className="text-danger d-block"
              data-testid="inline-comment-resolve-error"
            >
              {resolveError}
            </span>
          )}
        </div>

        {/* No `!isEditing` guard around the thread: each entry owns its own
            edit / delete state, so editing one leaves every sibling and the
            reply form displayed. */}
        {repliesFromOldest.length > 0 && (
          <div data-testid="inline-comment-preview-popover-replies">
            {repliesFromOldest.map((reply) => (
              <div
                key={reply.id}
                data-testid="inline-comment-preview-popover-reply"
                className="mt-4"
              >
                <InlineCommentPopoverEntry
                  id={reply.id}
                  creator={reply.creator}
                  createdAt={reply.createdAt}
                  commentText={reply.comment}
                  rendererOptions={rendererOptions}
                  // `creatorId`, not the populated `creator`: the same
                  // ownership check InlineCommentReplies.tsx makes.
                  isOwn={currentUser?._id === reply.creatorId}
                  editorKeyPrefix="inline_comment_preview_popover_reply_edit"
                  onUpdate={(text) => updateReply(reply.id, text)}
                  onRemove={() => removeReply(reply.id)}
                  testIdPrefix="inline-comment-preview-popover-reply"
                />
              </div>
            ))}
          </div>
        )}

        {/* Read-only-user restriction (inline-comment-readonly-restriction
            Requirement 2.2, 2.4). This form has no open/closed toggle stage
            like the list view's reply toggle -- it's always shown -- so the
            whole form is wrapped, not just the send button. */}
        <NotAvailableIfReadOnlyUserNotAllowedToComment>
          <div className="inline-comment-preview-popover-reply-form d-flex align-items-start border border-primary-subtle rounded p-2 gap-2">
            <UserPicture user={currentUser} className="ms-2" noLink noTooltip />
            <MentionAwareCommentInput
              editorKey={replyEditorKey}
              onSubmit={(text) => createReply(comment.id, text)}
              onControlsChange={onReplyControlsChange}
            />
            <div className="d-flex align-items-center gap-1">
              <MentionPickerButton onInsert={insertMentionIntoReply} />
              <button
                type="button"
                className={`btn btn-primary btn-sm p-0 d-inline-flex align-items-center justify-content-center ${styles['inline-comment-preview-popover-send-button']}`}
                disabled={!canSubmitReply}
                onClick={submitReply}
                aria-label={t('page_comment.comment')}
              >
                <span
                  className="material-symbols-outlined fs-6"
                  aria-hidden="true"
                >
                  send
                </span>
              </button>
            </div>
          </div>
        </NotAvailableIfReadOnlyUserNotAllowedToComment>
      </div>
    </div>,
    document.body,
  );
};
