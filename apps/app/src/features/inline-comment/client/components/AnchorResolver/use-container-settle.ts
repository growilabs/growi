import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';
import {
  GROWI_IS_CONTENT_RENDERING_ATTR,
  GROWI_IS_CONTENT_RENDERING_SELECTOR,
} from '@growi/core/dist/consts';

import { WATCH_TIMEOUT_MS } from '~/client/util/watch-rendering-and-rescroll';

// Re-exported so callers (and this file's own tests) don't need to know the
// constant is shared with watch-rendering-and-rescroll.ts.
export { WATCH_TIMEOUT_MS };

/**
 * Whether an element matching GROWI_IS_CONTENT_RENDERING_SELECTOR currently
 * exists inside the container.
 */
export const hasRenderingElements = (container: HTMLElement): boolean => {
  return container.querySelector(GROWI_IS_CONTENT_RENDERING_SELECTOR) != null;
};

/**
 * Watches `container` for DOM changes and calls `onSettle` every time the
 * container is confirmed to hold no element carrying the GROWI "content
 * rendering" status protocol (`data-growi-is-content-rendering`).
 *
 * Firing is not limited to the moment such elements reach zero: any change
 * with no rendering marker at all (e.g. a heading's edit button appearing
 * once collaborative-editing state loads) also changes the container's text
 * and must give the caller a chance to re-resolve.
 *
 * Checks triggered by an observed DOM change are coalesced per animation
 * frame, so many changes in one rendering pass produce at most one
 * `onSettle`. The mount-time check is deliberately **not** coalesced: it
 * fires synchronously, so it isn't reordered against `useAnchorResolver`'s
 * own mount-time resolve of its `anchors` input.
 *
 * If rendering elements are still present after WATCH_TIMEOUT_MS,
 * observation stops and `onSettle` fires once as a best-effort fallback, so
 * the caller is never left waiting forever.
 *
 * Returns a cleanup function that stops observation and clears timers.
 */
export const observeContainerSettle = (
  container: HTMLElement,
  onSettle: () => void,
): (() => void) => {
  let stopped = false;
  let isSettled = false;
  let pendingFrame: number | undefined;

  const cleanup = () => {
    stopped = true;
    observer.disconnect();
    window.clearTimeout(watchTimeoutId);
    if (pendingFrame != null) {
      window.cancelAnimationFrame(pendingFrame);
      pendingFrame = undefined;
    }
  };

  /**
   * The single "evaluate the container, fire if settled" step. Called
   * synchronously for the mount-time check and from inside a frame for
   * checks triggered by an observed DOM change — the predicate and the
   * firing live here only, so both paths cannot drift apart.
   */
  const fireIfSettled = () => {
    if (stopped) return;

    if (hasRenderingElements(container)) {
      // Re-arm: the WATCH_TIMEOUT_MS fallback below fires only for a
      // container that never settled.
      isSettled = false;
      return;
    }

    isSettled = true;
    onSettle();
  };

  const scheduleSettle = () => {
    // A frame is already pending: let it fire — don't reschedule, so all
    // changes observed within one frame collapse into a single call.
    if (pendingFrame != null) return;

    pendingFrame = window.requestAnimationFrame(() => {
      pendingFrame = undefined;
      // fireIfSettled re-evaluates the container here: another widget may
      // have started rendering between scheduling and this frame, in which
      // case the container is no longer settled.
      fireIfSettled();
    });
  };

  const observer = new MutationObserver(scheduleSettle);

  observer.observe(container, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [GROWI_IS_CONTENT_RENDERING_ATTR],
    // A same-length in-place text correction (e.g. fixing a typo, editing a
    // word) makes React update an existing Text node's `data` rather than
    // replacing any element -- a `characterData` mutation, not a `childList`
    // one. Without watching for it, editing near a saved inline-comment
    // anchor and returning to View (no full page reload) never re-triggers
    // `useAnchorResolver`, so the highlight can stay anchored to stale
    // offsets or vanish outright, even though a fresh page load (which
    // resolves once at mount regardless of this observer) gets it right.
    // Confirmed via a live-page MutationObserver probe that ReactMarkdown
    // really does emit a standalone `characterData` record for this case.
    characterData: true,
  });

  const watchTimeoutId = window.setTimeout(() => {
    if (stopped) return;
    // Mirror watchRenderingAndReScroll: stop observing before firing the
    // fallback, so a widget that never settles cannot cause any further
    // callbacks past this point.
    const shouldFire = !isSettled;
    cleanup();
    if (shouldFire) onSettle();
  }, WATCH_TIMEOUT_MS);

  // Initial check, fired synchronously (see the note on ordering above) so a
  // container with no rendering elements settles without waiting for a DOM
  // change. Armed after watchTimeoutId, which `cleanup` closes over.
  fireIfSettled();

  return cleanup;
};

/**
 * React hook wrapper around {@link observeContainerSettle}. Subscribes to
 * settle events of the DOM under `containerRef` and invokes `onSettle` each
 * time the container has zero in-progress rendering elements (see above).
 *
 * `onSettle` is read through a ref updated on every render, so passing a
 * new closure each render (as `useAnchorResolver` does) does not
 * re-subscribe the observer — only a change of the observed container does.
 */
export const useContainerSettle = (
  containerRef: RefObject<HTMLElement | null>,
  onSettle: () => void,
): void => {
  const onSettleRef = useRef(onSettle);
  onSettleRef.current = onSettle;

  useEffect(() => {
    const container = containerRef.current;
    if (container == null) return;

    return observeContainerSettle(container, () => onSettleRef.current());
    // `onSettle` is intentionally omitted: it is read through onSettleRef
    // above so a new closure each render does not tear down and
    // re-subscribe the observer.
  }, [containerRef]);
};
