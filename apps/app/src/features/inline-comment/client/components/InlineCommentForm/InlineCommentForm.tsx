/**
 * Comment-creation form shown by `SelectionCapture` once a text selection
 * has been captured. The mention-aware editor, submission, and error display
 * are owned by the shared `MentionAwareCommentInput`, whose submit and
 * mention-picker buttons this form renders itself (inline to the right of
 * the editor) from the controls that component reports; this form owns the
 * quote (visually hidden — the range is already highlighted in the body, but
 * kept in the DOM for the Playwright suite and screen readers), the
 * composing user's avatar, cancellation (no visible Cancel button — Escape
 * or an outside click), and the `create()` call.
 */

import type { JSX } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { UserPicture } from '@growi/ui/dist/components';
import { useTranslation } from 'react-i18next';

import { useCurrentUser } from '~/states/global';

import { useSWRxInlineComments } from '../../stores/inline-comment';
import { MentionAwareCommentInput } from '../MentionAwareCommentInput/MentionAwareCommentInput';
import { useCommentInputControls } from '../MentionAwareCommentInput/use-comment-input-controls';
import type { CapturedSelection } from '../SelectionCapture/use-text-selection';
import { MentionPickerButton } from './MentionPickerButton';

type InlineCommentFormProps = {
  pageId: string;
  /** The revision the captured anchor was computed against. */
  anchorOriginRevisionId: string;
  /** The locked-in selection this form was opened for. */
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

  const { t } = useTranslation();
  const { create } = useSWRxInlineComments(pageId);
  const currentUser = useCurrentUser();

  // The editor reports its submit / mention-insert controls outward and
  // renders no buttons itself, so this form places them — inline to the
  // right of the editor, where they have always been.
  const { canSubmit, submit, insertMention, onControlsChange } =
    useCommentInputControls();

  // One create-form editor instance per page.
  const editorKey = useMemo(() => `inline_comment_new_${pageId}`, [pageId]);

  // Backstop for an empty selection, ANDed with MentionAwareCommentInput's
  // own empty-text guard, in case a future caller skips SelectionCapture's
  // null-selection guard.
  const hasValidAnchor = anchor.quote !== '';

  const formRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (onCanceled == null) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      // The mention-picker dropdown also closes on Escape without preventDefault,
      // so without this check the same keypress would close it AND cancel the form.
      if (formRef.current?.querySelector('[aria-expanded="true"]') != null) {
        return;
      }
      onCanceled();
    };
    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target as Element | null;
      if (
        formRef.current != null &&
        target != null &&
        formRef.current.contains(target)
      ) {
        return;
      }
      // The mention-completion popup is appended to document.body, not nested
      // in this form, so a click inside it would otherwise read as "outside".
      if (target?.closest('.cm-tooltip-autocomplete') != null) {
        return;
      }
      onCanceled();
    };

    // Capture phase: reactstrap's Escape handler runs on bubble and flips
    // aria-expanded to false before a bubble-phase listener would see it.
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [onCanceled]);

  return (
    <div
      ref={formRef}
      className="inline-comment-form bg-body border rounded shadow-sm p-2"
      // Explicit width: Popper sizes this box via shrink-to-fit, but nothing
      // inside has intrinsic width once the quote is hidden, so it would
      // collapse to a sliver. Capped against viewport width since Popper's
      // preventOverflow shifts but doesn't shrink this box.
      style={{ width: 'min(24rem, calc(100vw - 2rem))' }}
      data-testid="inline-comment-form"
    >
      {/* Plain class, not CSS-module: the Playwright suite locates the quote by this selector. */}
      <blockquote className="inline-comment-form-quote visually-hidden">
        {anchor.quote}
      </blockquote>
      <div className="d-flex align-items-start gap-2">
        <UserPicture user={currentUser} noLink noTooltip />
        <MentionAwareCommentInput
          editorKey={editorKey}
          disabled={!hasValidAnchor}
          // The form appears already-focused-on-a-selection, so the user
          // should be able to start typing immediately without an extra
          // click (user request, 2026-09-11).
          autoFocus
          onSubmit={(comment) =>
            create({ pageId, anchorOriginRevisionId, comment, anchor })
          }
          onSubmitted={onSubmitted}
          onControlsChange={onControlsChange}
        />
        <div className="d-flex align-items-center gap-1">
          <MentionPickerButton onInsert={insertMention} />
          <button
            type="button"
            className="btn btn-primary btn-sm p-0 d-inline-flex align-items-center justify-content-center"
            style={{ width: '2rem', height: '2rem' }}
            data-testid="inline-comment-submit-button"
            disabled={!canSubmit}
            onClick={submit}
            aria-label={t('page_comment.comment')}
          >
            <span className="material-symbols-outlined fs-6" aria-hidden="true">
              send
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
