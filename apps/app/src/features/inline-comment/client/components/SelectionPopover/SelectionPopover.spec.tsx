import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { SelectionPopover } from './SelectionPopover';

// `@popperjs/core` is mocked at its lowest level (`createPopper`) rather than
// mocking `usePopperPosition`: the reference element Popper actually receives
// is the only observable that proves the range → virtual element → popper
// wiring is complete. Mocking the hook would let the component pass `null`
// forever without any test noticing.
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
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON: () => ({}),
    ...overrides,
  }) as DOMRect;

const VALID_RECT = buildRect({
  x: 10,
  y: 20,
  width: 100,
  height: 16,
  top: 20,
  left: 10,
  right: 110,
  bottom: 36,
});
/** The same selection after the page was scrolled — a second, distinct valid rect. */
const SCROLLED_RECT = buildRect({
  x: 10,
  y: 300,
  width: 100,
  height: 16,
  top: 300,
  left: 10,
  right: 110,
  bottom: 316,
});
const ZERO_RECT = buildRect({ x: 42, y: 84, top: 84, left: 42 });

/**
 * The reference element the n-th Popper instance was constructed with
 * (a Popper virtual element).
 */
const capturedReference = (
  callIndex = 0,
): { getBoundingClientRect: () => DOMRect } => {
  const call = mockCreatePopper.mock.calls[callIndex];
  expect(call).toBeDefined();
  return call[0] as { getBoundingClientRect: () => DOMRect };
};

describe('SelectionPopover', () => {
  beforeEach(() => {
    mockCreatePopper.mockClear();
  });

  it('renders its children through a portal into document.body, outside its own render location', () => {
    const range = mock<Range>({
      getBoundingClientRect: vi.fn(() => VALID_RECT),
    });

    const { container } = render(
      <SelectionPopover range={range}>
        <button type="button">Comment</button>
      </SelectionPopover>,
    );

    const child = screen.getByRole('button', { name: 'Comment' });
    expect(document.body).toContainElement(child);
    // Proves the portal: the child is NOT inside the component's own container.
    expect(container).not.toContainElement(child);
  });

  // Regression guard: the portal is a direct child of `document.body`, so
  // whether it paints above page content depends on stacking order, not DOM
  // order — a page-layout ancestor elsewhere on the page can carry an
  // explicit `z-index` that is not contained by any intervening stacking
  // context, which then out-paints this portal's implicit z-index of 0 and
  // makes the action button/form unclickable (observed live in Chromium via
  // Playwright; jsdom has no layout/paint engine, so no test here can assert
  // the actual hit-testing outcome — only that the style contract is set).
  it('sets an explicit z-index on the portaled element so it reliably paints above page content', () => {
    const range = mock<Range>({
      getBoundingClientRect: vi.fn(() => VALID_RECT),
    });

    render(
      <SelectionPopover range={range}>
        <button type="button">Comment</button>
      </SelectionPopover>,
    );

    const popperElement = mockCreatePopper.mock.calls[0][1] as HTMLElement;
    expect(popperElement.style.zIndex).not.toBe('');
    expect(Number(popperElement.style.zIndex)).toBeGreaterThan(0);
  });

  it('passes a virtual element backed by the given range, and the portal DOM node, to createPopper', () => {
    const range = mock<Range>({
      getBoundingClientRect: vi.fn(() => VALID_RECT),
    });

    render(
      <SelectionPopover range={range}>
        <button type="button">Comment</button>
      </SelectionPopover>,
    );

    expect(mockCreatePopper).toHaveBeenCalledTimes(1);

    // The reference resolves to the range's own rect ...
    expect(capturedReference().getBoundingClientRect()).toEqual(VALID_RECT);
    expect(range.getBoundingClientRect).toHaveBeenCalled();

    // ... and the popper element is the portaled node that wraps the children.
    const popperElement = mockCreatePopper.mock.calls[0][1] as HTMLElement;
    expect(document.body).toContainElement(popperElement);
    expect(popperElement).toContainElement(
      screen.getByRole('button', { name: 'Comment' }),
    );
  });

  // Requirement 1.3: the popover follows the selection as it changes — a new
  // range must re-derive the position instead of keeping the first one.
  it('re-positions against the new range when a different range is passed in', () => {
    const rangeA = mock<Range>({
      getBoundingClientRect: vi.fn(() => VALID_RECT),
    });
    const rangeB = mock<Range>({
      getBoundingClientRect: vi.fn(() => SCROLLED_RECT),
    });

    const { rerender } = render(
      <SelectionPopover range={rangeA}>
        <button type="button">Comment</button>
      </SelectionPopover>,
    );

    expect(mockCreatePopper).toHaveBeenCalledTimes(1);
    expect(capturedReference(0).getBoundingClientRect()).toEqual(VALID_RECT);

    rerender(
      <SelectionPopover range={rangeB}>
        <button type="button">Comment</button>
      </SelectionPopover>,
    );

    expect(mockCreatePopper).toHaveBeenCalledTimes(2);
    expect(capturedReference(1).getBoundingClientRect()).toEqual(SCROLLED_RECT);
    expect(rangeB.getBoundingClientRect).toHaveBeenCalled();
  });

  it('keeps serving the last valid rect when the range starts reporting a zero rect', () => {
    const getBoundingClientRect = vi
      .fn<() => DOMRect>()
      .mockReturnValueOnce(VALID_RECT)
      .mockReturnValueOnce(SCROLLED_RECT)
      .mockReturnValue(ZERO_RECT);
    const range = mock<Range>({ getBoundingClientRect });

    render(
      <SelectionPopover range={range}>
        <button type="button">Comment</button>
      </SelectionPopover>,
    );

    const reference = capturedReference();

    // First read: the range still has a real rect, so it is used as-is.
    expect(reference.getBoundingClientRect()).toEqual(VALID_RECT);

    // A cloned Range keeps tracking the live document position, so a later
    // valid rect (e.g. after scrolling) must be used and remembered.
    expect(reference.getBoundingClientRect()).toEqual(SCROLLED_RECT);

    // Subsequent reads collapse to a zero rect (e.g. the range's nodes were
    // replaced by a re-render) — the popover must not jump to that degenerate
    // position, and it falls back to the *latest* valid rect, not the first.
    expect(reference.getBoundingClientRect()).toEqual(SCROLLED_RECT);
  });

  it('serves the range rect as-is when no valid rect has ever been observed', () => {
    const range = mock<Range>({
      getBoundingClientRect: vi.fn(() => ZERO_RECT),
    });

    render(
      <SelectionPopover range={range}>
        <button type="button">Comment</button>
      </SelectionPopover>,
    );

    expect(capturedReference().getBoundingClientRect()).toEqual(ZERO_RECT);
  });
});
