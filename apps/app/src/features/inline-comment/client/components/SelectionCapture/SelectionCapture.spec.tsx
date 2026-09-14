import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { SelectionCapture } from './SelectionCapture';
import type { CapturedSelection } from './use-text-selection';

// Same mocking pattern already used by InlineCommentPopoverEntry.spec.tsx /
// InlineCommentItem.spec.tsx for this exact guard (Requirement 2.1, 2.4).
const isDisabledRef = vi.hoisted(() => ({ current: false }));
vi.mock('~/client/components/NotAvailableForReadOnlyUser', () => ({
  NotAvailableIfReadOnlyUserNotAllowedToComment: ({
    children,
  }: {
    children: JSX.Element;
  }) => {
    if (!isDisabledRef.current) {
      return children;
    }
    return (
      <fieldset disabled data-testid="not-available-for-read-only-user">
        {children}
      </fieldset>
    );
  },
}));

const textSelectionStore = vi.hoisted(() => ({
  captured: null as CapturedSelection | null,
}));

vi.mock('./use-text-selection', () => ({
  useTextSelection: () => textSelectionStore.captured,
}));

// The form itself is out of this task's boundary; it is stubbed down to the
// two observables SelectionCapture's state machine depends on: the anchor it
// was handed, and its onSubmitted / onCanceled callbacks.
vi.mock('../InlineCommentForm/InlineCommentForm', () => ({
  InlineCommentForm: (props: {
    anchor: CapturedSelection;
    onSubmitted: () => void;
    onCanceled: () => void;
  }) => (
    <div data-testid="inline-comment-form">
      <span data-testid="form-quote">{props.anchor.quote}</span>
      <button
        type="button"
        data-testid="form-submit"
        onClick={props.onSubmitted}
      >
        submit
      </button>
      <button
        type="button"
        data-testid="form-cancel"
        onClick={props.onCanceled}
      >
        cancel
      </button>
    </div>
  ),
}));

// `PendingSelectionHighlight` (task 3.2) is mocked down to the one thing this
// task's requirements (12.4-12.7) care about: which `Range` it was handed at
// each stage. It renders a marker only when `range` is non-null, so its
// absence directly proves the highlight is gone (Requirement 12.7).
type PendingHighlightCall = { range: Range | null };
const pendingHighlightCalls: PendingHighlightCall[] = [];
vi.mock('../PendingSelectionHighlight/PendingSelectionHighlight', () => ({
  PendingSelectionHighlight: (props: PendingHighlightCall) => {
    pendingHighlightCalls.push(props);
    return props.range == null ? null : (
      <div data-testid="pending-selection-highlight" />
    );
  },
}));

// `SelectionPopover` is deliberately NOT mocked — this task is the first to
// mount it, and the range it receives (a live range while selecting, a frozen
// clone while composing) is the crux of Requirement 2.3. Popper itself is
// mocked at its lowest level, mirroring SelectionPopover.spec.tsx, so the
// reference element handed to `createPopper` stays observable.
const mockCreatePopper = vi.fn(
  (_reference: unknown, _popper: unknown, _options: unknown) => ({
    destroy: vi.fn(),
    update: vi.fn(),
    setOptions: vi.fn(),
  }),
);

vi.mock('@popperjs/core', () => ({
  createPopper: (reference: unknown, popper: unknown, options: unknown) =>
    mockCreatePopper(reference, popper, options),
}));

const buildRect = (overrides: Partial<DOMRect>): DOMRect =>
  ({
    x: 0,
    y: 0,
    width: 100,
    height: 16,
    top: 0,
    right: 100,
    bottom: 16,
    left: 0,
    toJSON: () => ({}),
    ...overrides,
  }) as DOMRect;

/** Rect of the live document selection. */
const LIVE_RECT = buildRect({ top: 20, bottom: 36, y: 20 });
/** Rect of the same selection after the user extended it. */
const EXTENDED_LIVE_RECT = buildRect({ top: 60, bottom: 76, y: 60 });
/** Rect of the clone taken at commit time — distinct from every live rect. */
const CLONED_RECT = buildRect({ top: 200, bottom: 216, y: 200 });

const ANCHOR: CapturedSelection = {
  quote: 'hello world',
  prefix: 'pre',
  suffix: 'suf',
  approxOffset: 10,
};

const removeAllRanges = vi.fn();

/**
 * A live range whose `cloneRange()` returns a *distinct* object reporting a
 * distinct rect, so "the popover is positioned against the clone" is directly
 * observable.
 */
const buildLiveRange = (rect: DOMRect = LIVE_RECT) => {
  const cloned = mock<Range>({
    getBoundingClientRect: vi.fn(() => CLONED_RECT),
  });
  const live = mock<Range>({
    getBoundingClientRect: vi.fn(() => rect),
    cloneRange: vi.fn(() => cloned),
  });
  return { live, cloned };
};

const setLiveSelection = (range: Range | null): void => {
  const selection =
    range == null
      ? mock<Selection>({ rangeCount: 0, removeAllRanges })
      : mock<Selection>({
          rangeCount: 1,
          getRangeAt: vi.fn(() => range),
          removeAllRanges,
        });
  vi.spyOn(window, 'getSelection').mockReturnValue(selection);
};

/** The reference (Popper virtual element) the n-th Popper was built with. */
const capturedReference = (
  callIndex: number,
): { getBoundingClientRect: () => DOMRect } => {
  const call = mockCreatePopper.mock.calls[callIndex];
  expect(call).toBeDefined();
  return call[0] as { getBoundingClientRect: () => DOMRect };
};

// One stable ref identity for every render, matching how PageView passes its
// own `pageBodyContainerRef` — a fresh ref per rerender would misrepresent the
// real render sequence (the unmocked `useTextSelection` keys its subscription
// effect on this ref).
const containerRef = createRef<HTMLDivElement>();

// A fresh element per call (never a shared one): React bails out of
// re-rendering when handed a referentially identical element, which would hide
// the selection change the test just made.
const captureElement = (): React.ReactElement => (
  <SelectionCapture
    containerRef={containerRef}
    pageId="page-1"
    anchorOriginRevisionId="rev-1"
  />
);

const renderCapture = () => render(captureElement());

const rerenderCapture = (rerender: (ui: React.ReactElement) => void): void =>
  rerender(captureElement());

describe('SelectionCapture', () => {
  beforeEach(() => {
    // Re-established (not just cleared): `restoreAllMocks` below can drop a
    // plain `vi.fn`'s implementation depending on project config, which would
    // leave `createPopper` returning undefined in later tests.
    mockCreatePopper.mockReset().mockImplementation(() => ({
      destroy: vi.fn(),
      update: vi.fn(),
      setOptions: vi.fn(),
    }));
    removeAllRanges.mockClear();
    setLiveSelection(null);
    pendingHighlightCalls.length = 0;
    isDisabledRef.current = false;
  });

  afterEach(() => {
    textSelectionStore.captured = null;
    vi.restoreAllMocks();
  });

  // Requirement 1.2: an empty selection shows no create action at all.
  it('renders nothing while there is no captured selection', () => {
    renderCapture();

    expect(
      screen.queryByTestId('selection-action-button'),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('inline-comment-form')).not.toBeInTheDocument();
  });

  // Task 6.3 fix: the idle stage still renders an invisible marker, so
  // Playwright can detect that this client-only bundle has mounted before it
  // is safe to fire the raw-selection helper (no other observable DOM change
  // — this is purely additive to the `null` branch it replaces).
  it('renders an invisible readiness marker while idle', () => {
    renderCapture();

    const marker = screen.getByTestId('inline-comment-ready');
    expect(marker).toBeInTheDocument();
    expect(marker).toHaveAttribute('hidden');
    expect(marker).toBeEmptyDOMElement();
  });

  // Requirement 1.1: a non-empty selection shows the lightweight create action
  // — not the full form (that is Requirement 2.1's job).
  it('shows only the action button once a non-empty selection exists', () => {
    const { live } = buildLiveRange();
    setLiveSelection(live);
    textSelectionStore.captured = ANCHOR;

    renderCapture();

    expect(screen.getByTestId('selection-action-button')).toBeInTheDocument();
    expect(screen.queryByTestId('inline-comment-form')).not.toBeInTheDocument();
    expect(capturedReference(0).getBoundingClientRect()).toEqual(LIVE_RECT);
    // The idle-only marker is not rendered once selecting — that stage
    // already has an observable DOM footprint of its own.
    expect(
      screen.queryByTestId('inline-comment-ready'),
    ).not.toBeInTheDocument();
  });

  // Requirement 1.3: the action button follows a changing selection.
  it('re-positions the action button against the new range when the selection changes', () => {
    const first = buildLiveRange();
    setLiveSelection(first.live);
    textSelectionStore.captured = ANCHOR;

    const { rerender } = renderCapture();
    expect(capturedReference(0).getBoundingClientRect()).toEqual(LIVE_RECT);

    const second = buildLiveRange(EXTENDED_LIVE_RECT);
    setLiveSelection(second.live);
    textSelectionStore.captured = { ...ANCHOR, quote: 'hello world!' };
    rerenderCapture(rerender);

    expect(capturedReference(1).getBoundingClientRect()).toEqual(
      EXTENDED_LIVE_RECT,
    );
  });

  // Requirement 1.4: releasing the selection before expanding removes the button.
  it('goes back to rendering nothing when the selection is released while the button is shown', () => {
    const { live } = buildLiveRange();
    setLiveSelection(live);
    textSelectionStore.captured = ANCHOR;

    const { rerender } = renderCapture();
    expect(screen.getByTestId('selection-action-button')).toBeInTheDocument();

    textSelectionStore.captured = null;
    setLiveSelection(null);
    rerenderCapture(rerender);

    expect(
      screen.queryByTestId('selection-action-button'),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('inline-comment-form')).not.toBeInTheDocument();
  });

  // Requirement 2.1: the form appears only once the create action is chosen,
  // carrying the anchor captured at that moment (Requirement 2.2's quote).
  it('expands into the form with the anchor captured at commit time', () => {
    const { live } = buildLiveRange();
    setLiveSelection(live);
    textSelectionStore.captured = ANCHOR;

    renderCapture();
    fireEvent.click(screen.getByTestId('selection-action-button'));

    expect(screen.getByTestId('form-quote')).toHaveTextContent('hello world');
    expect(
      screen.queryByTestId('selection-action-button'),
    ).not.toBeInTheDocument();
    // The idle-only marker is not rendered once composing.
    expect(
      screen.queryByTestId('inline-comment-ready'),
    ).not.toBeInTheDocument();
  });

  // Requirement 2.3: moving the caret into the form's own textarea reports an
  // empty selection to `useTextSelection` — that must not close the form.
  it('keeps the form open when the document selection is lost while composing', () => {
    const { live } = buildLiveRange();
    setLiveSelection(live);
    textSelectionStore.captured = ANCHOR;

    const { rerender } = renderCapture();
    fireEvent.click(screen.getByTestId('selection-action-button'));

    textSelectionStore.captured = null;
    setLiveSelection(null);
    rerenderCapture(rerender);

    expect(screen.getByTestId('inline-comment-form')).toBeInTheDocument();

    // A brand-new selection elsewhere must not revert to the button either.
    const other = buildLiveRange(EXTENDED_LIVE_RECT);
    setLiveSelection(other.live);
    textSelectionStore.captured = { ...ANCHOR, quote: 'somewhere else' };
    rerenderCapture(rerender);

    expect(screen.getByTestId('inline-comment-form')).toBeInTheDocument();
    expect(screen.getByTestId('form-quote')).toHaveTextContent('hello world');
    expect(
      screen.queryByTestId('selection-action-button'),
    ).not.toBeInTheDocument();
  });

  // Requirement 2.3 / design.md: the form is positioned against a *clone* of
  // the range taken at commit time, not the live selection.
  it('positions the form against a clone of the range taken at commit time', () => {
    const { live, cloned } = buildLiveRange();
    setLiveSelection(live);
    textSelectionStore.captured = ANCHOR;

    const { rerender } = renderCapture();
    fireEvent.click(screen.getByTestId('selection-action-button'));

    expect(live.cloneRange).toHaveBeenCalledTimes(1);

    const formReference = capturedReference(
      mockCreatePopper.mock.calls.length - 1,
    );
    expect(formReference.getBoundingClientRect()).toEqual(CLONED_RECT);
    expect(cloned.getBoundingClientRect).toHaveBeenCalled();

    // The live selection changing afterwards leaves the form's position alone.
    const other = buildLiveRange(EXTENDED_LIVE_RECT);
    setLiveSelection(other.live);
    textSelectionStore.captured = { ...ANCHOR, quote: 'somewhere else' };
    rerenderCapture(rerender);

    expect(
      capturedReference(
        mockCreatePopper.mock.calls.length - 1,
      ).getBoundingClientRect(),
    ).toEqual(CLONED_RECT);
  });

  // Requirement 2.4
  it.each([
    ['submitted', 'form-submit'],
    ['canceled', 'form-cancel'],
  ])('closes the form and clears the selection when %s', (_label, testId) => {
    const { live } = buildLiveRange();
    setLiveSelection(live);
    textSelectionStore.captured = ANCHOR;

    renderCapture();
    fireEvent.click(screen.getByTestId('selection-action-button'));
    fireEvent.click(screen.getByTestId(testId));

    expect(screen.queryByTestId('inline-comment-form')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('selection-action-button'),
    ).not.toBeInTheDocument();
    expect(removeAllRanges).toHaveBeenCalled();
  });

  // Requirement 12.4: while selecting (before the create action is chosen),
  // the highlight tracks the live selection range.
  it('paints the live range while selecting', () => {
    const { live } = buildLiveRange();
    setLiveSelection(live);
    textSelectionStore.captured = ANCHOR;

    renderCapture();

    expect(
      screen.getByTestId('pending-selection-highlight'),
    ).toBeInTheDocument();
    expect(pendingHighlightCalls.at(-1)?.range).toBe(live);
  });

  // Requirement 12.5 / 12.6: once the form is open, the highlight tracks the
  // range committed at that moment — and stays put (does not disappear) once
  // moving the caret into the form's textarea drops the document selection.
  it('paints the committed range while composing, even after the document selection is lost', () => {
    const { live, cloned } = buildLiveRange();
    setLiveSelection(live);
    textSelectionStore.captured = ANCHOR;

    const { rerender } = renderCapture();
    fireEvent.click(screen.getByTestId('selection-action-button'));

    expect(
      screen.getByTestId('pending-selection-highlight'),
    ).toBeInTheDocument();
    expect(pendingHighlightCalls.at(-1)?.range).toBe(cloned);

    // Caret moves into the textarea: the document selection is reported empty.
    textSelectionStore.captured = null;
    setLiveSelection(null);
    rerenderCapture(rerender);

    expect(
      screen.getByTestId('pending-selection-highlight'),
    ).toBeInTheDocument();
    expect(pendingHighlightCalls.at(-1)?.range).toBe(cloned);
  });

  // Requirement 12.7: closing the form (submit or cancel) removes the
  // highlight along with the rest of the composing UI.
  it.each([
    ['submitted', 'form-submit'],
    ['canceled', 'form-cancel'],
  ])('removes the highlight when the form is %s', (_label, testId) => {
    const { live } = buildLiveRange();
    setLiveSelection(live);
    textSelectionStore.captured = ANCHOR;

    renderCapture();
    fireEvent.click(screen.getByTestId('selection-action-button'));
    expect(
      screen.getByTestId('pending-selection-highlight'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId(testId));

    expect(
      screen.queryByTestId('pending-selection-highlight'),
    ).not.toBeInTheDocument();
  });

  // Requirement 2.1: while a read-only user is not allowed to comment, the
  // create-trigger button is disabled via the same guard already used for
  // the edit/delete actions elsewhere in this feature.
  it('disables the action button when the read-only user is not allowed to comment', () => {
    isDisabledRef.current = true;
    const { live } = buildLiveRange();
    setLiveSelection(live);
    textSelectionStore.captured = ANCHOR;

    renderCapture();

    expect(
      screen.getByTestId('not-available-for-read-only-user'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('selection-action-button')).toBeInTheDocument();
  });

  // Requirement 2.4: an allowed read-only (or normal) user keeps the usual,
  // unguarded button — covered implicitly by every other test above (they
  // never set `isDisabledRef.current`), asserted explicitly here too.
  it('does not disable the action button when the read-only user is allowed to comment', () => {
    isDisabledRef.current = false;
    const { live } = buildLiveRange();
    setLiveSelection(live);
    textSelectionStore.captured = ANCHOR;

    renderCapture();

    expect(
      screen.queryByTestId('not-available-for-read-only-user'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('selection-action-button')).toBeInTheDocument();
  });
});
