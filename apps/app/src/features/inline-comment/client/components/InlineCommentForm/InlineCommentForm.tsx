/**
 * Comment-creation form shown by `SelectionCapture` (task 4.2) once a text
 * selection has been captured (design.md's "作成フロー（起点コメント）" sequence:
 * SelectionCapture -> InlineCommentForm -> Store).
 *
 * The comment-body input follows the mention-aware textarea pattern already
 * established by `CommentEditor.tsx`
 * (apps/app/src/client/components/PageComment/CommentEditor.tsx): the same
 * `CodeMirrorEditorComment` component, `useCodeMirrorEditorIsolated` store,
 * and `createMentionCompletionExtension` / `mentionDecorationSettings`
 * extensions from `@growi/editor`, rather than a plain `<textarea>`. This
 * gives @mentions in an inline comment the same autocomplete and highlight
 * behavior as the page-bottom comment thread (Requirement 3.1). Per the
 * task boundary, `CommentEditor.tsx` itself is not modified — only the same
 * underlying building blocks are reused here in a new component.
 */

import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSetResolvedTheme } from '@growi/editor';
import { CodeMirrorEditorComment } from '@growi/editor/dist/client/components/CodeMirrorEditorComment';
import {
  createMentionCompletionExtension,
  mentionDecorationSettings,
} from '@growi/editor/dist/client/services';
import { useCodeMirrorEditorIsolated } from '@growi/editor/dist/client/stores/codemirror-editor';

import { useNextThemes } from '~/stores-universal/use-next-themes';

import { fetchMentionUsers } from '../../services/fetch-mention-users';
import { useSWRxInlineComments } from '../../stores/inline-comment';
import type { CapturedSelection } from '../SelectionCapture/use-text-selection';
import { MentionPickerButton } from './MentionPickerButton';

type InlineCommentFormProps = {
  pageId: string;
  /** The revision the captured anchor was computed against (design.md's `anchorOriginRevisionId`). */
  anchorOriginRevisionId: string;
  /** The locked-in selection this form was opened for (SelectionCapture's task 2.3 output). */
  anchor: CapturedSelection;
  /** Called after a successful create (e.g. to close the form / clear the selection). */
  onSubmitted?: () => void;
  /** Called when the user cancels without submitting. */
  onCanceled?: () => void;
};

export const InlineCommentForm = (
  props: InlineCommentFormProps,
): JSX.Element => {
  const { pageId, anchorOriginRevisionId, anchor, onSubmitted, onCanceled } =
    props;

  const { create } = useSWRxInlineComments(pageId);

  // One create-form editor instance per page, mirroring CommentEditor's
  // GlobalCodeMirrorEditorKey.COMMENT_NEW reuse for all new top-level comments.
  const editorKey = useMemo(() => `inline_comment_new_${pageId}`, [pageId]);
  const { data: codeMirrorEditor } = useCodeMirrorEditorIsolated(editorKey);

  const setResolvedTheme = useSetResolvedTheme();
  const { resolvedTheme } = useNextThemes();
  useEffect(() => {
    setResolvedTheme(resolvedTheme);
  }, [resolvedTheme, setResolvedTheme]);

  const [commentText, setCommentText] = useState('');
  const [error, setError] = useState<string>();

  const mentionExtension = useMemo(
    () => createMentionCompletionExtension(fetchMentionUsers),
    [],
  );

  useEffect(() => {
    return codeMirrorEditor?.appendExtensions?.([mentionDecorationSettings]);
  }, [codeMirrorEditor]);

  useEffect(() => {
    return codeMirrorEditor?.appendExtensions?.(mentionExtension);
  }, [codeMirrorEditor, mentionExtension]);

  const cmProps = useMemo(
    () => ({
      onChange: (value: string) => setCommentText(value),
    }),
    [],
  );

  // Requirement 1.7: creation must stay disabled for an empty selection, even
  // if a future caller renders this form without going through
  // SelectionCapture's own null-selection guard.
  const hasValidAnchor = anchor.quote !== '';
  const canSubmit = hasValidAnchor && commentText.trim() !== '';

  const submitHandler = useCallback(async () => {
    if (!canSubmit) {
      return;
    }
    try {
      await create({
        pageId,
        anchorOriginRevisionId,
        comment: commentText,
        anchor,
      });
      codeMirrorEditor?.initDoc('');
      setCommentText('');
      setError(undefined);
      onSubmitted?.();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'An unknown error occurred when posting the inline comment',
      );
    }
  }, [
    canSubmit,
    create,
    pageId,
    anchorOriginRevisionId,
    commentText,
    anchor,
    codeMirrorEditor,
    onSubmitted,
  ]);

  // Requirement 3.3: inserts "@<username> " at the current cursor position in
  // the comment body, via the same insertText API EmojiButton.tsx uses for
  // its own "insert at cursor" pattern.
  const insertMention = useCallback(
    (username: string) => {
      codeMirrorEditor?.insertText(`@${username} `);
    },
    [codeMirrorEditor],
  );

  return (
    <div
      className="inline-comment-form bg-body border rounded shadow-sm p-2"
      data-testid="inline-comment-form"
    >
      <blockquote className="inline-comment-form-quote">
        {anchor.quote}
      </blockquote>
      <CodeMirrorEditorComment
        editorKey={editorKey}
        cmProps={cmProps}
        onSave={submitHandler}
      />
      {error != null && <span className="text-danger">{error}</span>}
      <div className="inline-comment-form-actions">
        <MentionPickerButton onInsert={insertMention} />
        <button type="button" onClick={onCanceled}>
          Cancel
        </button>
        <button
          type="button"
          data-testid="inline-comment-submit-button"
          disabled={!canSubmit}
          onClick={submitHandler}
        >
          Comment
        </button>
      </div>
    </div>
  );
};
