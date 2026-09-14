/**
 * Mention-aware comment input shared by the inline-comment create form, the
 * list item's and the popover's edit modes, and the reply edit mode. Owns
 * the CodeMirror editor assembly, submission, and error display — but no
 * buttons at all: neither Cancel (each caller handles cancellation its own
 * way — Escape / outside click for the create form, an explicit button in
 * the edit modes) nor Save / mention-picker. Those are reported outward
 * through `onControlsChange` and rendered by the caller, which is what lets
 * the edit modes put Save next to their own Cancel below the input while the
 * create form keeps it inline to the right of the editor.
 *
 * The actual persistence call is injected via `onSubmit`, so this component
 * has no dependency on the inline-comment store.
 */

import type { JSX } from 'react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { EditorView, tooltips } from '@codemirror/view';
import { useSetResolvedTheme } from '@growi/editor';
import { CodeMirrorEditorComment } from '@growi/editor/dist/client/components/CodeMirrorEditorComment';
import {
  createMentionCompletionExtension,
  mentionDecorationSettings,
} from '@growi/editor/dist/client/services';
import { useCodeMirrorEditorIsolated } from '@growi/editor/dist/client/stores/codemirror-editor';

import { useNextThemes } from '~/stores-universal/use-next-themes';

import { fetchMentionUsers } from '../../services/fetch-mention-users';
import type { MentionAwareCommentInputControls } from './use-comment-input-controls';

type MentionAwareCommentInputProps = {
  /** CodeMirror editor instance key; callers compute one per editor instance. */
  editorKey: string;
  /** Edit-mode initial text, applied to the editor exactly once at mount. */
  initialValue?: string;
  /**
   * Persists the comment text. Rejections are caught here and shown as an
   * error; the caller does not need its own try/catch.
   */
  onSubmit: (commentText: string) => Promise<unknown>;
  /** Called after a successful submit (e.g. to close the form / clear the selection). */
  onSubmitted?: () => void;
  /** An additional, caller-owned guard ANDed with this component's own "has non-empty text" check. */
  disabled?: boolean;
  /** Focuses the editor once it becomes ready, so a freshly-opened form is immediately typeable. */
  autoFocus?: boolean;
  /**
   * Reports the submit / mention-insert controls and whether submitting is
   * currently possible, so the caller can render those buttons wherever its
   * own layout needs them. Use `useCommentInputControls()` on the caller
   * side rather than wiring this by hand.
   */
  onControlsChange?: (controls: MentionAwareCommentInputControls) => void;
};

export const MentionAwareCommentInput = (
  props: MentionAwareCommentInputProps,
): JSX.Element => {
  const {
    editorKey,
    initialValue,
    onSubmit,
    onSubmitted,
    disabled,
    autoFocus,
    onControlsChange,
  } = props;

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

  // Without an explicit `parent`, the mention-completion popup appends inside
  // `.cm-editor`, which has `overflow: hidden` in its base theme, so it would
  // render clipped in this small fixed-height form instead of floating above it.
  useEffect(() => {
    return codeMirrorEditor?.appendExtensions?.(
      tooltips({ parent: document.body }),
    );
  }, [codeMirrorEditor]);

  // 1080 is one step above Bootstrap's $zindex-popover (1070), so this popup
  // paints above SelectionPopover's portal instead of behind it.
  const tooltipZIndexTheme = useMemo(
    () =>
      EditorView.theme({
        '.cm-tooltip.cm-tooltip-autocomplete': { zIndex: '1080' },
      }),
    [],
  );

  useEffect(() => {
    // Must stay wrapped in an array: EditorView.theme() itself returns two
    // extensions, and appendExtensions would otherwise unpack them into two
    // top-level slots and throw "Duplicate use of compartment".
    return codeMirrorEditor?.appendExtensions?.([tooltipZIndexTheme]);
  }, [codeMirrorEditor, tooltipZIndexTheme]);

  // Applies `initialValue` once codeMirrorEditor first becomes available
  // (it arrives asynchronously, so this effect re-runs until then). The ref
  // flag stops it from re-applying on later re-renders, which would fight
  // the user's own edits.
  const hasAppliedInitialValueRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `initialValue` is intentionally excluded -- must not re-run when it changes later.
  useEffect(() => {
    if (hasAppliedInitialValueRef.current || codeMirrorEditor == null) {
      return;
    }
    if (initialValue != null) {
      codeMirrorEditor.initDoc(initialValue);
    }
    hasAppliedInitialValueRef.current = true;
  }, [codeMirrorEditor]);

  const cmProps = useMemo(
    () => ({
      onChange: (value: string) => setCommentText(value),
      basicSetup: { lineNumbers: false, foldGutter: false }, // gutters are wasted space in this one-to-few-line input
      // @uiw/react-codemirror re-checks this in its own `[autoFocus, view]`
      // effect, so it still focuses once `view` becomes available even
      // though CodeMirror's own initialization is asynchronous (see
      // codemirror-editor.ts / its spec for that async-readiness contract).
      autoFocus,
    }),
    [autoFocus],
  );

  const canSubmit = disabled !== true && commentText.trim() !== '';

  const submitHandler = useCallback(async () => {
    if (!canSubmit) {
      return;
    }
    try {
      await onSubmit(commentText);
      codeMirrorEditor?.initDoc('');
      setCommentText('');
      setError(undefined);
      onSubmitted?.();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'An unknown error occurred when posting the comment',
      );
    }
  }, [canSubmit, onSubmit, commentText, codeMirrorEditor, onSubmitted]);

  const insertMention = useCallback(
    (username: string) => {
      codeMirrorEditor?.insertText(`@${username} `);
    },
    [codeMirrorEditor],
  );

  // The two callables are handed out with a stable identity, backed by a ref
  // that always points at the latest closure. Without this, `submitHandler`
  // (whose deps include the caller's `onSubmit`, typically a fresh closure
  // per render) would change identity every render and the notification
  // below would fire endlessly against a caller that re-renders on it.
  // useLayoutEffect (not useEffect): commits before the browser paints and
  // before a user-initiated click can be handled, closing the (theoretical --
  // React already flushes pending effects ahead of an event handler) gap
  // between "this render committed" and "the ref points at this render's
  // closure."
  const latestHandlersRef = useRef({ submitHandler, insertMention });
  useLayoutEffect(() => {
    latestHandlersRef.current = { submitHandler, insertMention };
  }, [submitHandler, insertMention]);

  const submit = useCallback(() => {
    latestHandlersRef.current.submitHandler();
  }, []);
  const insertMentionControl = useCallback((username: string) => {
    latestHandlersRef.current.insertMention(username);
  }, []);

  useEffect(() => {
    onControlsChange?.({
      canSubmit,
      submit,
      insertMention: insertMentionControl,
    });
  }, [canSubmit, submit, insertMentionControl, onControlsChange]);

  // flex-basis 0% (not the .flex-grow-1 utility's `auto`): the editor's root
  // sets width:100% internally, so an `auto` basis creates a circular width
  // reference that collapses this item to near zero. Kept now that the
  // button group lives in the caller — a caller that keeps its buttons
  // inline places them as siblings of this element in its own flex row, so
  // this is still the growing item. The error stays inside rather than as a
  // sibling, so it cannot become another flex item in that row.
  return (
    <div style={{ flex: '1 1 0%', minWidth: 0 }}>
      <CodeMirrorEditorComment
        editorKey={editorKey}
        cmProps={cmProps}
        hideToolbar
        onSave={submitHandler}
      />
      {error != null && (
        <span className="text-danger small d-block mt-1">{error}</span>
      )}
    </div>
  );
};
