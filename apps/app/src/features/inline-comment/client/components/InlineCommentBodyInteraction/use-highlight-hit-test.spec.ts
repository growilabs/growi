// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';

import type { ResolvedRange } from '../../../interfaces';
import { rangesById } from '../../services/resolved-range';
import {
  type HitTestTarget,
  hitTestRanges,
  useHighlightHitTest,
} from './use-highlight-hit-test';

const { deviceState } = vi.hoisted(() => ({
  deviceState: { isLargerThanMd: true },
}));

vi.mock('~/states/ui/device', () => ({
  // The real hook returns a [value, setter] tuple; keep that shape so
  // destructuring in the hook under test does not silently yield undefined.
  useDeviceLargerThanMd: () => [deviceState.isLargerThanMd, vi.fn()] as const,
}));

const buildRect = (
  left: number,
  top: number,
  right: number,
  bottom: number,
): DOMRect => new DOMRect(left, top, right - left, bottom - top);

const targetWithRects = (...rects: readonly DOMRect[]): HitTestTarget => ({
  getClientRects: () => rects,
});

/** A rect covering x 10..20, y 10..20. */
const RECT_A = buildRect(10, 10, 20, 20);
/** A rect covering x 100..200, y 100..120 (far from RECT_A). */
const RECT_B = buildRect(100, 100, 200, 120);

const mountContainer = (): HTMLElement => {
  const container = document.createElement('div');
  container.textContent = 'The quick brown fox jumps over the lazy dog.';
  document.body.appendChild(container);
  return container;
};

const dispatchPointerEvent = (
  target: EventTarget,
  type: 'pointermove' | 'click',
  clientX: number,
  clientY: number,
): void => {
  // happy-dom does not reliably provide a constructible PointerEvent;
  // PointerEvent extends MouseEvent and only the type string matters here.
  target.dispatchEvent(
    new MouseEvent(type, { clientX, clientY, bubbles: true }),
  );
};

let queuedFrames: FrameRequestCallback[] = [];
let cancelledFrames: number[] = [];
let originalRaf: typeof globalThis.requestAnimationFrame;
let originalCancelRaf: typeof globalThis.cancelAnimationFrame;

beforeEach(() => {
  deviceState.isLargerThanMd = true;
  queuedFrames = [];
  cancelledFrames = [];
  originalRaf = globalThis.requestAnimationFrame;
  originalCancelRaf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    queuedFrames.push(callback);
    return queuedFrames.length;
  });
  globalThis.cancelAnimationFrame = vi.fn((handle: number) => {
    cancelledFrames.push(handle);
  });
});

afterEach(() => {
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.cancelAnimationFrame = originalCancelRaf;
  document.body.innerHTML = '';
});

const runQueuedFrames = (): void => {
  const frames = queuedFrames;
  queuedFrames = [];
  act(() => {
    for (const frame of frames) {
      frame(performance.now());
    }
  });
};

describe('hitTestRanges', () => {
  it('returns the id of the candidate whose rect contains the point', () => {
    const candidates = new Map<string, HitTestTarget>([
      ['comment-a', targetWithRects(RECT_A)],
      ['comment-b', targetWithRects(RECT_B)],
    ]);

    expect(hitTestRanges(candidates, 15, 15)).toBe('comment-a');
    expect(hitTestRanges(candidates, 150, 110)).toBe('comment-b');
  });

  it('returns null when the point is outside every candidate rect', () => {
    const candidates = new Map<string, HitTestTarget>([
      ['comment-a', targetWithRects(RECT_A)],
    ]);

    expect(hitTestRanges(candidates, 50, 50)).toBeNull();
    expect(hitTestRanges(candidates, 15, 50)).toBeNull();
    expect(hitTestRanges(candidates, 50, 15)).toBeNull();
  });

  it('matches when the point falls in any one of a multi-rect (wrapped) candidate', () => {
    const candidates = new Map<string, HitTestTarget>([
      ['wrapped', targetWithRects(RECT_A, RECT_B)],
    ]);

    expect(hitTestRanges(candidates, 15, 15)).toBe('wrapped');
    expect(hitTestRanges(candidates, 150, 110)).toBe('wrapped');
    expect(hitTestRanges(candidates, 60, 60)).toBeNull();
  });

  it('never matches a candidate with no client rects, not even at the origin', () => {
    // A Range that is collapsed or not currently laid out reports zero rects.
    // Guarding on the rect list (rather than a single bounding rect, which
    // would be all zeros for such a Range) is what keeps a pointer at (0, 0)
    // from matching an invisible highlight.
    const candidates = new Map<string, HitTestTarget>([
      ['not-laid-out', targetWithRects()],
    ]);

    expect(hitTestRanges(candidates, 0, 0)).toBeNull();
    expect(hitTestRanges(candidates, 15, 15)).toBeNull();
  });
});

describe('useHighlightHitTest', () => {
  it('reports a hover hit on desktop width when the pointer enters a highlight rect', () => {
    const container = mountContainer();
    const containerRef = { current: container };
    const ranges = new Map<string, HitTestTarget>([
      ['comment-a', targetWithRects(RECT_A)],
    ]);

    const { result } = renderHook(() =>
      useHighlightHitTest(containerRef, ranges),
    );
    expect(result.current).toBeNull();

    act(() => {
      dispatchPointerEvent(container, 'pointermove', 15, 15);
    });
    runQueuedFrames();

    expect(result.current).toEqual({ commentId: 'comment-a', source: 'hover' });
  });

  it('coalesces multiple pointermove events into a single animation frame', () => {
    const container = mountContainer();
    const containerRef = { current: container };
    const ranges = new Map<string, HitTestTarget>([
      ['comment-a', targetWithRects(RECT_A)],
    ]);

    renderHook(() => useHighlightHitTest(containerRef, ranges));

    act(() => {
      dispatchPointerEvent(container, 'pointermove', 11, 11);
      dispatchPointerEvent(container, 'pointermove', 12, 12);
      dispatchPointerEvent(container, 'pointermove', 13, 13);
    });

    expect(queuedFrames).toHaveLength(1);
  });

  it('cancels a pending animation frame on unmount', () => {
    const container = mountContainer();
    const containerRef = { current: container };
    const ranges = new Map<string, HitTestTarget>();

    const { unmount } = renderHook(() =>
      useHighlightHitTest(containerRef, ranges),
    );

    act(() => {
      dispatchPointerEvent(container, 'pointermove', 15, 15);
    });
    expect(queuedFrames).toHaveLength(1);

    unmount();

    expect(cancelledFrames).toHaveLength(1);
  });

  it('clears the hit when the pointer leaves every highlight rect', () => {
    const container = mountContainer();
    const containerRef = { current: container };
    const ranges = new Map<string, HitTestTarget>([
      ['comment-a', targetWithRects(RECT_A)],
    ]);

    const { result } = renderHook(() =>
      useHighlightHitTest(containerRef, ranges),
    );

    act(() => {
      dispatchPointerEvent(container, 'pointermove', 15, 15);
    });
    runQueuedFrames();
    expect(result.current?.commentId).toBe('comment-a');

    act(() => {
      dispatchPointerEvent(container, 'pointermove', 500, 500);
    });
    runQueuedFrames();

    expect(result.current).toBeNull();
  });

  it('reports a click hit on desktop width', () => {
    const container = mountContainer();
    const containerRef = { current: container };
    const ranges = new Map<string, HitTestTarget>([
      ['comment-a', targetWithRects(RECT_A)],
    ]);

    const { result } = renderHook(() =>
      useHighlightHitTest(containerRef, ranges),
    );

    act(() => {
      dispatchPointerEvent(container, 'click', 15, 15);
    });

    expect(result.current).toEqual({ commentId: 'comment-a', source: 'click' });
  });

  it('ignores hover but still reports tap (click) on tablet-and-below width', () => {
    deviceState.isLargerThanMd = false;
    const container = mountContainer();
    const containerRef = { current: container };
    const ranges = new Map<string, HitTestTarget>([
      ['comment-a', targetWithRects(RECT_A)],
    ]);

    const { result } = renderHook(() =>
      useHighlightHitTest(containerRef, ranges),
    );

    act(() => {
      dispatchPointerEvent(container, 'pointermove', 15, 15);
    });
    runQueuedFrames();
    expect(result.current).toBeNull();
    expect(queuedFrames).toHaveLength(0);

    act(() => {
      dispatchPointerEvent(container, 'click', 15, 15);
    });

    expect(result.current).toEqual({ commentId: 'comment-a', source: 'click' });
  });

  it('hit-tests against the latest candidate map, not the one from first render', () => {
    // `rangesById()` rebuilds its Map on every call by design, so the hook
    // sees a new map identity on every render of its consumer.
    const container = mountContainer();
    const containerRef = { current: container };
    const staleRanges = new Map<string, HitTestTarget>([
      ['stale-comment', targetWithRects()],
    ]);
    const freshRanges = new Map<string, HitTestTarget>([
      ['fresh-comment', targetWithRects(RECT_A)],
    ]);

    let ranges: ReadonlyMap<string, HitTestTarget> = staleRanges;
    const { result, rerender } = renderHook(() =>
      useHighlightHitTest(containerRef, ranges),
    );

    ranges = freshRanges;
    rerender();

    act(() => {
      dispatchPointerEvent(container, 'click', 15, 15);
    });

    expect(result.current?.commentId).toBe('fresh-comment');
  });

  it('ignores events that happen outside the body container', () => {
    const container = mountContainer();
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    const containerRef = { current: container };
    const ranges = new Map<string, HitTestTarget>([
      ['comment-a', targetWithRects(RECT_A)],
    ]);

    const { result } = renderHook(() =>
      useHighlightHitTest(containerRef, ranges),
    );

    act(() => {
      dispatchPointerEvent(outside, 'click', 15, 15);
    });

    expect(result.current).toBeNull();
  });

  it('starts working once the container ref is populated after mount', () => {
    const containerRef: { current: HTMLElement | null } = { current: null };
    const ranges = new Map<string, HitTestTarget>([
      ['comment-a', targetWithRects(RECT_A)],
    ]);

    const { result, rerender } = renderHook(() =>
      useHighlightHitTest(containerRef, ranges),
    );

    const container = mountContainer();
    containerRef.current = container;
    rerender();

    act(() => {
      dispatchPointerEvent(container, 'click', 15, 15);
    });

    expect(result.current?.commentId).toBe('comment-a');
  });

  it('does not offer a candidate whose anchor failed to resolve (not_found)', () => {
    const container = mountContainer();
    const resolvedRanges = new Map<string, ResolvedRange>([
      ['resolved-id', { status: 'exact', startOffset: 4, endOffset: 9 }],
      ['not-found-id', { status: 'not_found' }],
    ]);

    const candidates = rangesById(container, resolvedRanges);

    expect([...candidates.keys()]).toEqual(['resolved-id']);
    // A ReadonlyMap<string, Range> is a valid candidate set for the hit test.
    const { result } = renderHook(() =>
      useHighlightHitTest({ current: container }, candidates),
    );
    act(() => {
      dispatchPointerEvent(container, 'click', 0, 0);
    });

    expect(result.current).toBeNull();
  });
});
