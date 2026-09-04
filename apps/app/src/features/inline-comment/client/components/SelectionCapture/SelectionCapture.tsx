/**
 * Owns the three-stage state machine that carries a text selection from
 * "something is selected" to "the comment form is open" (design.md's
 * SelectionCapture: 「本文選択の監視から入力フォームのクローズまでの状態機械を管理する」).
 *
 * It decides *when* each piece is shown; `SelectionPopover` decides *where*,
 * and `InlineCommentForm` owns *what* gets submitted.
 */

import type { JSX, RefObject } from 'react';
import { useCallback, useEffect, useState } from 'react';

import { InlineCommentForm } from '../InlineCommentForm/InlineCommentForm';
import { SelectionPopover } from '../SelectionPopover/SelectionPopover';
import { SelectionActionButton } from './SelectionActionButton';
import type { CapturedSelection } from './use-text-selection';
import { useTextSelection } from './use-text-selection';

type SelectionCaptureProps = {
  /** Ref to the page-body container whose text selection is monitored (Requirement 1.1). */
  containerRef: RefObject<HTMLElement | null>;
  pageId: string;
  anchorOriginRevisionId: string;
};

/**
 * design.md's state model
 * (`{ stage, liveRange, committedAnchor, committedRange }`) encoded as a
 * discriminated union, so a stage can never be paired with the fields that do
 * not belong to it.
 */
type SelectionState =
  | { stage: 'idle' }
  /** A non-empty selection exists; the create action is offered, nothing committed yet. */
  | { stage: 'selecting'; anchor: CapturedSelection; liveRange: Range }
  /** The create action was chosen; the range is frozen for as long as the form is open. */
  | {
      stage: 'composing';
      committedAnchor: CapturedSelection;
      committedRange: Range;
    };

const IDLE_STATE: SelectionState = { stage: 'idle' };

/**
 * The live document selection's first range. `useTextSelection` intentionally
 * exposes only the captured anchor data (quote/prefix/suffix/offset), not the
 * `Range` itself, so the range is read here instead.
 */
const readLiveRange = (): Range | null => {
  const selection =
    typeof window === 'undefined' ? null : window.getSelection();
  if (selection == null || selection.rangeCount === 0) {
    return null;
  }
  return selection.getRangeAt(0);
};

export const SelectionCapture = (
  props: SelectionCaptureProps,
): JSX.Element | null => {
  const { containerRef, pageId, anchorOriginRevisionId } = props;

  const captured = useTextSelection(containerRef);
  const [state, setState] = useState<SelectionState>(IDLE_STATE);

  useEffect(() => {
    setState((current) => {
      // Once composing, the document selection is no longer the source of
      // truth: moving the caret into the form's own textarea is reported as an
      // empty selection, and reacting to it would close the form the instant
      // the user tried to type (Requirement 2.3).
      if (current.stage === 'composing') {
        return current;
      }

      const liveRange = captured == null ? null : readLiveRange();
      if (captured == null || liveRange == null) {
        return current.stage === 'idle' ? current : IDLE_STATE;
      }

      // A fresh `selecting` state on every capture, so the popover
      // re-positions as the selection grows (Requirement 1.3).
      return { stage: 'selecting', anchor: captured, liveRange };
    });
  }, [captured]);

  /** Requirement 2.1: the create action was chosen — expand into the form. */
  const commit = useCallback(() => {
    setState((current) => {
      if (current.stage !== 'selecting') {
        return current;
      }
      return {
        stage: 'composing',
        committedAnchor: current.anchor,
        // The clone keeps tracking its document position independently of the
        // live selection, so the form stays put no matter what the user
        // selects (or de-selects) next.
        committedRange: current.liveRange.cloneRange(),
      };
    });
  }, []);

  /** Requirement 2.4 */
  const closeForm = useCallback(() => {
    setState(IDLE_STATE);
    // Clear the browser selection too, so re-selecting the same range later
    // is detected as a fresh selectionchange rather than a no-op.
    window.getSelection()?.removeAllRanges();
  }, []);

  // Requirement 1.2 / 1.4: nothing selected and nothing being composed.
  if (state.stage === 'idle') {
    return null;
  }

  if (state.stage === 'selecting') {
    return (
      <SelectionPopover range={state.liveRange}>
        {/* mousedown's default action collapses the document selection before
            `click` fires, which would report an empty selection and unmount
            this button mid-gesture — so `onCommit` would never run. Preventing
            the default keeps the selection alive through the click. Deliberately
            NOT applied to the form below: there, the user must be able to put
            the caret into the textarea. */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: not an interactive element itself — it only suppresses mousedown's selection-collapsing default for the button it wraps */}
        <div onMouseDown={(event) => event.preventDefault()}>
          <SelectionActionButton onCommit={commit} />
        </div>
      </SelectionPopover>
    );
  }

  return (
    <SelectionPopover range={state.committedRange}>
      <InlineCommentForm
        pageId={pageId}
        anchorOriginRevisionId={anchorOriginRevisionId}
        anchor={state.committedAnchor}
        onSubmitted={closeForm}
        onCanceled={closeForm}
      />
    </SelectionPopover>
  );
};
