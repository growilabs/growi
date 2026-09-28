import { type RefObject, useEffect, useRef, useState } from 'react';

import { useDeviceLargerThanMd } from '~/states/ui/device';

/**
 * The minimum surface the hit test needs from a highlight candidate.
 *
 * Declared structurally rather than as `Range` so that a caller (and a test)
 * can supply any object able to report its client rects; a real
 * `ReadonlyMap<string, Range>` — what `rangesById()` returns — is assignable
 * to `ReadonlyMap<string, HitTestTarget>` as-is.
 */
export interface HitTestTarget {
  getClientRects(): ArrayLike<DOMRectReadOnly>;
}

/** Which interaction produced the current hit. */
export type HighlightHitSource = 'hover' | 'click';

export interface HighlightHit {
  commentId: string;
  source: HighlightHitSource;
}

/**
 * Returns the id of the first candidate whose client rects contain
 * (`clientX`, `clientY`), or `null` when the point hits none of them.
 *
 * A candidate reporting zero rects (a collapsed Range, or one whose content is
 * not currently laid out) never matches — deliberately rect-list based rather
 * than `getBoundingClientRect()`, whose all-zero result for such a Range would
 * make a pointer at the viewport origin match an invisible highlight.
 *
 * Overlapping highlights are resolved by iteration order only; z-order is out of scope.
 */
export const hitTestRanges = (
  candidates: Iterable<readonly [string, HitTestTarget]>,
  clientX: number,
  clientY: number,
): string | null => {
  for (const [commentId, candidate] of candidates) {
    const rects = candidate.getClientRects();
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      if (
        rect != null &&
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return commentId;
      }
    }
  }
  return null;
};

/**
 * Hit-tests pointer interactions inside the page body against the saved
 * inline-comment highlights, and reports the currently hit comment id.
 *
 * Saved highlights have no DOM element of their own — they exist only as
 * `Range`s registered in `CSS.highlights` — so there's nothing to attach a
 * listener to. Events are taken at the document level and filtered to those
 * originating inside `containerRef`'s subtree, since the container ref is
 * still null on the first effect run for a body container rendered in the
 * same commit.
 *
 * `pointermove` is coalesced to at most one hit test per animation frame, and
 * is only consulted at desktop width; at tablet-and-below width `click` (tap)
 * is the sole trigger.
 *
 * Closing the popover on an outside click is not this hook's job: the
 * popover renders outside the body container, so a container-scoped hook
 * structurally cannot see those clicks; its owner
 * (`InlineCommentBodyInteraction`) handles it.
 */
export const useHighlightHitTest = (
  containerRef: RefObject<HTMLElement | null>,
  ranges: ReadonlyMap<string, HitTestTarget>,
): HighlightHit | null => {
  const [hit, setHit] = useState<HighlightHit | null>(null);
  const [isLargerThanMd] = useDeviceLargerThanMd();

  // `rangesById()` rebuilds its Map on every call by design, so depending on
  // `ranges` directly would re-attach the listeners on every render of the
  // consumer. Read it through a ref refreshed each render instead.
  const rangesRef = useRef(ranges);
  rangesRef.current = ranges;

  useEffect(() => {
    let pendingFrame: number | null = null;

    const applyHit = (
      commentId: string | null,
      source: HighlightHitSource,
    ): void => {
      setHit((prev) => {
        if (commentId == null) {
          return prev == null ? prev : null;
        }
        return prev?.commentId === commentId && prev.source === source
          ? prev
          : { commentId, source };
      });
    };

    /**
     * Viewport coordinates of an interaction already confirmed to originate
     * inside the body container. Read at event time (never inside a deferred
     * frame callback) because an event's `target` is no longer usable once
     * dispatch has finished.
     */
    const pointInContainer = (
      event: MouseEvent,
    ): { clientX: number; clientY: number } | null => {
      const container = containerRef.current;
      if (container == null || !container.contains(event.target as Node)) {
        return null;
      }
      return { clientX: event.clientX, clientY: event.clientY };
    };

    // Holds the most recent pointermove of the current frame, so coalescing
    // keeps the pointer's latest position rather than the frame's first one.
    let latestPoint: { clientX: number; clientY: number } | null = null;

    const onPointerMove = (event: PointerEvent): void => {
      if (!isLargerThanMd) {
        return;
      }
      const point = pointInContainer(event);
      if (point == null) {
        return;
      }
      latestPoint = point;
      if (pendingFrame != null) {
        return;
      }
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = null;
        if (latestPoint != null) {
          applyHit(
            hitTestRanges(
              rangesRef.current,
              latestPoint.clientX,
              latestPoint.clientY,
            ),
            'hover',
          );
          latestPoint = null;
        }
      });
    };

    const onClick = (event: MouseEvent): void => {
      const point = pointInContainer(event);
      if (point == null) {
        return;
      }
      applyHit(
        hitTestRanges(rangesRef.current, point.clientX, point.clientY),
        'click',
      );
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('click', onClick);
      if (pendingFrame != null) {
        cancelAnimationFrame(pendingFrame);
      }
    };
  }, [containerRef, isLargerThanMd]);

  return hit;
};
