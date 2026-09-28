/**
 * Owns the three-stage state machine that carries a text selection from
 * "something is selected" to "the comment form is open". It decides *when*
 * each piece is shown; `SelectionPopover` decides *where*, and
 * `InlineCommentForm` owns *what* gets submitted.
 */

import type { JSX, RefObject } from 'react';
import { useCallback, useEffect, useState } from 'react';

import { NotAvailableIfReadOnlyUserNotAllowedToComment } from '~/client/components/NotAvailableForReadOnlyUser';

import { InlineCommentForm } from '../InlineCommentForm/InlineCommentForm';
import { PendingSelectionHighlight } from '../PendingSelectionHighlight/PendingSelectionHighlight';
import { SelectionPopover } from '../SelectionPopover/SelectionPopover';
import { SelectionActionButton } from './SelectionActionButton';
import type { CapturedSelection } from './use-text-selection';
import { useTextSelection } from './use-text-selection';

type SelectionCaptureProps = {
  /** Ref to the page-body container whose text selection is monitored. */
  containerRef: RefObject<HTMLElement | null>;
  pageId: string;
  anchorOriginRevisionId: string;
};

// Discriminated union so a stage can never be paired with fields that don't belong to it.
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
      // truth: moving the caret into the form's own textarea is reported as
      // an empty selection, which would otherwise close the form mid-typing.
      if (current.stage === 'composing') {
        return current;
      }

      const liveRange = captured == null ? null : readLiveRange();
      if (captured == null || liveRange == null) {
        return current.stage === 'idle' ? current : IDLE_STATE;
      }

      // A fresh `selecting` state on every capture, so the popover re-positions as the selection grows.
      return { stage: 'selecting', anchor: captured, liveRange };
    });
  }, [captured]);

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

  const closeForm = useCallback(() => {
    setState(IDLE_STATE);
    // Clear the browser selection too, so re-selecting the same range later
    // is detected as a fresh selectionchange rather than a no-op.
    window.getSelection()?.removeAllRanges();
  }, []);

  // Renders an invisible marker rather than `null`: it's the only DOM trace
  // that this client-only bundle has actually mounted, and Playwright specs
  // wait on it before firing a text-selection helper with no built-in retry.
  if (state.stage === 'idle') {
    return <span data-testid="inline-comment-ready" hidden />;
  }

  if (state.stage === 'selecting') {
    return (
      <>
        <PendingSelectionHighlight
          range={state.liveRange}
          containerRef={containerRef}
        />
        <SelectionPopover range={state.liveRange}>
          {/* mousedown's default action collapses the selection before click fires,
              which would unmount this button mid-gesture. Not applied to the form
              below, where the user must be able to put the caret into the textarea. */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: not an interactive element itself — it only suppresses mousedown's selection-collapsing default for the button it wraps */}
          <div onMouseDown={(event) => event.preventDefault()}>
            <NotAvailableIfReadOnlyUserNotAllowedToComment>
              <SelectionActionButton onCommit={commit} />
            </NotAvailableIfReadOnlyUserNotAllowedToComment>
          </div>
        </SelectionPopover>
      </>
    );
  }

  return (
    <>
      {/* Keeps the highlight painted while the form is open, independent of
          the document selection (lost once the caret moves into the textarea). */}
      <PendingSelectionHighlight
        range={state.committedRange}
        containerRef={containerRef}
      />
      <SelectionPopover range={state.committedRange}>
        <InlineCommentForm
          pageId={pageId}
          anchorOriginRevisionId={anchorOriginRevisionId}
          anchor={state.committedAnchor}
          onSubmitted={closeForm}
          onCanceled={closeForm}
        />
      </SelectionPopover>
    </>
  );
};
