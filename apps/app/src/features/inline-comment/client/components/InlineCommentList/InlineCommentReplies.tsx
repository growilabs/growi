/**
 * Nested reply display + a minimal reply-submission UI for an inline
 * comment thread (design.md: File Structure Plan >
 * `InlineCommentList/InlineCommentReplies.tsx`, "返信のネスト表示。
 * ReplyComments.tsxの表示パターンを踏襲。既存コンポーネントは変更しない").
 *
 * Visual nesting follows `ReplyComments.tsx`
 * (`~/client/components/PageComment/ReplyComments.tsx`): each reply sits in
 * an indented container (`ms-4 ms-sm-5`), the same classes that component
 * uses. `ReplyComments.tsx` itself is not reused here — it is wired to the
 * legacy page-end comment feature's own state (delete modal, inline edit
 * mode, `ICommentHasId` shape), none of which fits an inline-comment reply
 * (no edit/delete per this spec's Non-Goals) — so this component follows
 * its established visual pattern instead of importing it, per the task
 * boundary ("既存コンポーネントは変更しない").
 *
 * Reply bodies render through `RevisionRenderer` with the caller-supplied
 * `rendererOptions` — the SAME `RendererOptions` the rest of the comment
 * feature uses (built by `generateCommentViewOptions`, which injects the
 * real `services/renderer/remark-plugins/mention` plugin), so `@username`
 * in a reply gets the same mention-highlight markup as everywhere else
 * (requirement 3.1). This component does not compute that highlighting
 * itself.
 *
 * A failed submission is surfaced inline (`.text-danger`), following the
 * same `try { ... } catch (err) { setError(...) }` convention
 * `InlineCommentForm.tsx` (task 4.2) already established for this feature,
 * rather than letting a rejected `onSubmitReply` promise go unhandled.
 */
import { type FC, type JSX, useState } from 'react';

import RevisionRenderer from '~/components/PageView/RevisionRenderer';
import type { RendererOptions } from '~/interfaces/renderer-options';

import type { InlineCommentReply } from '../../../interfaces';

type InlineCommentRepliesProps = {
  parentId: string;
  replies: InlineCommentReply[];
  /**
   * Undefined while the caller's renderer options are still loading — in
   * that case reply bodies fall back to plain text rather than blocking
   * the whole list on the renderer-options fetch.
   */
  rendererOptions: RendererOptions | undefined;
  onSubmitReply: (parentId: string, comment: string) => Promise<unknown>;
};

export const InlineCommentReplies: FC<InlineCommentRepliesProps> = (
  props,
): JSX.Element => {
  const { parentId, replies, rendererOptions, onSubmitReply } = props;

  const [draftComment, setDraftComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string>();

  const handleSubmit = async (): Promise<void> => {
    const trimmed = draftComment.trim();
    if (trimmed.length === 0 || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmitReply(parentId, trimmed);
      setDraftComment('');
      setSubmitError(undefined);
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'An unknown error occurred when posting the reply',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      data-testid="inline-comment-replies"
      className="inline-comment-replies"
    >
      {replies.map((reply) => (
        <div
          key={reply.id}
          data-testid="inline-comment-reply"
          className="inline-comment-reply ms-4 ms-sm-5 mt-2"
        >
          {rendererOptions != null ? (
            <RevisionRenderer
              rendererOptions={rendererOptions}
              markdown={reply.comment}
            />
          ) : (
            <span>{reply.comment}</span>
          )}
        </div>
      ))}

      <div className="inline-comment-reply-form ms-4 ms-sm-5 mt-2">
        <textarea
          className="form-control"
          aria-label="Reply"
          value={draftComment}
          disabled={isSubmitting}
          onChange={(e) => setDraftComment(e.target.value)}
        />
        {submitError != null && (
          <span
            className="text-danger d-block"
            data-testid="inline-comment-reply-error"
          >
            {submitError}
          </span>
        )}
        <button
          type="button"
          className="btn btn-sm btn-primary mt-1"
          disabled={draftComment.trim().length === 0 || isSubmitting}
          onClick={handleSubmit}
        >
          Reply
        </button>
      </div>
    </div>
  );
};
