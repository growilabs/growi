/**
 * Page-scoped inline-comment list (design.md: File Structure Plan >
 * `InlineCommentList/InlineCommentList.tsx`, "一覧表示（作成日時順、解決/
 * 未解決を区別）").
 *
 * Renders `useSWRxInlineComments(pageId)`'s list in the order the server
 * returns it. `InlineCommentService.listByPageId` (task 3.3, approved)
 * already sorts by creation date server-side (requirement 2.6), so this
 * component intentionally does not re-sort — re-sorting here would be a
 * second, drift-prone source of ordering truth.
 *
 * Resolved/unresolved comments are distinguished visually with a status
 * badge ("Resolved"/"Unresolved") plus a `data-resolved` attribute on the
 * list item (requirement 4.4) — chosen over e.g. strikethrough because a
 * resolved inline comment's text should stay fully legible (the underlying
 * discussion may still be read), see task CONCERNS.
 *
 * Origin comment bodies render through `RevisionRenderer` using the SAME
 * `RendererOptions` the existing page-end comment feature uses
 * (`useCommentForCurrentPageOptions`, backed by `generateCommentViewOptions`
 * — the function that injects the real `mention` remark plugin) so that
 * `@username` gets the same mention-highlight markup as everywhere else in
 * the comment feature (requirement 3.1). Reply display + reply submission
 * is delegated to `InlineCommentReplies`, which follows `ReplyComments.tsx`'s
 * nesting pattern (requirement 1.8, 2.5).
 *
 * The resolve/reopen action follows the same failure-surfacing convention
 * `InlineCommentForm.tsx` (task 4.2) already established for this feature
 * (`try { ... } catch (err) { setError(...) }`, shown inline as
 * `.text-danger`) rather than letting a rejected `resolve()` promise go
 * unhandled.
 */
import { type FC, type JSX, useState } from 'react';

import RevisionRenderer from '~/components/PageView/RevisionRenderer';
import type { RendererOptions } from '~/interfaces/renderer-options';
import { useCommentForCurrentPageOptions } from '~/stores/renderer';

import type { InlineCommentWithReplies } from '../../../interfaces';
import { useSWRxInlineComments } from '../../stores/inline-comment';
import { InlineCommentReplies } from './InlineCommentReplies';

type InlineCommentListProps = {
  pageId: string;
};

type InlineCommentItemProps = {
  comment: InlineCommentWithReplies;
  rendererOptions: RendererOptions | undefined;
  resolve: (id: string, resolved: boolean) => Promise<unknown>;
  createReply: (parentId: string, comment: string) => Promise<unknown>;
};

const InlineCommentItem: FC<InlineCommentItemProps> = (props): JSX.Element => {
  const { comment, rendererOptions, resolve, createReply } = props;

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

  return (
    <div
      data-testid="inline-comment-item"
      data-resolved={isResolved}
      className={`inline-comment-item mb-3${isResolved ? ' inline-comment-item-resolved' : ''}`}
    >
      <div className="d-flex align-items-center justify-content-between">
        <span
          data-testid="inline-comment-status"
          className={`badge ${isResolved ? 'bg-secondary' : 'bg-warning text-dark'}`}
        >
          {isResolved ? 'Resolved' : 'Unresolved'}
        </span>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          onClick={handleResolveToggle}
        >
          {isResolved ? 'Reopen' : 'Resolve'}
        </button>
      </div>
      {resolveError != null && (
        <span
          className="text-danger"
          data-testid="inline-comment-resolve-error"
        >
          {resolveError}
        </span>
      )}

      {rendererOptions != null ? (
        <RevisionRenderer
          rendererOptions={rendererOptions}
          markdown={comment.comment}
        />
      ) : (
        <span>{comment.comment}</span>
      )}

      <InlineCommentReplies
        parentId={comment.id}
        replies={comment.replies}
        rendererOptions={rendererOptions}
        onSubmitReply={createReply}
      />
    </div>
  );
};

export const InlineCommentList: FC<InlineCommentListProps> = (
  props,
): JSX.Element | null => {
  const { pageId } = props;

  const {
    data: inlineComments,
    resolve,
    createReply,
  } = useSWRxInlineComments(pageId);
  const { data: rendererOptions } = useCommentForCurrentPageOptions();

  if (inlineComments == null) {
    return null;
  }

  return (
    <div data-testid="inline-comment-list" className="inline-comment-list">
      {inlineComments.map((comment) => (
        <InlineCommentItem
          key={comment.id}
          comment={comment}
          rendererOptions={rendererOptions}
          resolve={resolve}
          createReply={(parentId, replyComment) =>
            createReply(parentId, { comment: replyComment })
          }
        />
      ))}
    </div>
  );
};
