/**
 * Wraps the page-body container's selection state (design.md's File
 * Structure Plan: "本文コンテナをラップし選択イベントを監視、フォーム表示をトリガ") and
 * shows `InlineCommentForm` once a non-empty text selection is captured via
 * `useTextSelection` (task 2.3).
 *
 * The captured anchor is locked in on first non-null capture and held
 * regardless of later `selectionchange` events, until the form is submitted
 * or canceled. Without this, focusing the form's own comment textarea would
 * move the document Selection outside the monitored container, which
 * `useTextSelection` reports as a null capture (Requirement 1.7's "empty
 * selection" case) — and the form would disappear the instant the user tried
 * to type into it.
 */

import type { JSX, RefObject } from 'react';
import { useCallback, useEffect, useState } from 'react';

import { InlineCommentForm } from '../InlineCommentForm/InlineCommentForm';
import type { CapturedSelection } from './use-text-selection';
import { useTextSelection } from './use-text-selection';

type SelectionCaptureProps = {
  /** Ref to the page-body container whose text selection is monitored (Requirement 1.1). */
  containerRef: RefObject<HTMLElement | null>;
  pageId: string;
  anchorOriginRevisionId: string;
};

export const SelectionCapture = (
  props: SelectionCaptureProps,
): JSX.Element | null => {
  const { containerRef, pageId, anchorOriginRevisionId } = props;

  const captured = useTextSelection(containerRef);
  const [lockedAnchor, setLockedAnchor] = useState<CapturedSelection | null>(
    null,
  );

  useEffect(() => {
    if (captured != null && lockedAnchor == null) {
      setLockedAnchor(captured);
    }
  }, [captured, lockedAnchor]);

  const closeForm = useCallback(() => {
    setLockedAnchor(null);
    // Clear the browser selection too, so re-selecting the same range later
    // is detected as a fresh selectionchange rather than a no-op.
    window.getSelection()?.removeAllRanges();
  }, []);

  // Requirement 1.7: no captured (non-empty) selection and no form currently
  // open — nothing to show, and there is no create action to disable.
  if (lockedAnchor == null) {
    return null;
  }

  return (
    <InlineCommentForm
      pageId={pageId}
      anchorOriginRevisionId={anchorOriginRevisionId}
      anchor={lockedAnchor}
      onSubmitted={closeForm}
      onCanceled={closeForm}
    />
  );
};
