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
 * Watches `container` for elements carrying the GROWI "content rendering"
 * status protocol (`data-growi-is-content-rendering`), and calls `onSettle`
 * whenever the number of such elements transitions to zero.
 *
 * Checks once immediately so a container with no async widgets settles
 * right away. While rendering elements remain present, a later transition
 * back to zero would fire again — this backs the self-healing re-anchoring
 * described in design.md's System Flows ("次の静定検知で再計算が走り、
 * ハイライトのズレは自己修復される") — but that only applies within the
 * WATCH_TIMEOUT_MS window; see below.
 *
 * If rendering elements are still present after WATCH_TIMEOUT_MS, observation
 * stops (mirroring `watchRenderingAndReScroll`'s own timeout behavior:
 * disconnect the observer and clear all timers) and `onSettle` fires once as
 * a best-effort fallback, so the caller is never left waiting forever
 * (Requirements 2.1, 5.1; design.md's use-container-settle section: "監視を
 * 打ち切り、その時点のDOMに対して1回だけ...実行する").
 *
 * Returns a cleanup function that stops observation and clears timers.
 */
export const observeContainerSettle = (
  container: HTMLElement,
  onSettle: () => void,
): (() => void) => {
  let stopped = false;
  let isSettled = false;

  const cleanup = () => {
    stopped = true;
    observer.disconnect();
    window.clearTimeout(watchTimeoutId);
  };

  const fireSettle = () => {
    isSettled = true;
    onSettle();
  };

  const check = () => {
    if (stopped) return;

    const hasRendering =
      container.querySelector(GROWI_IS_CONTENT_RENDERING_SELECTOR) != null;

    if (hasRendering) {
      // Re-arm: a later transition back to zero must fire again.
      isSettled = false;
      return;
    }

    if (!isSettled) fireSettle();
  };

  const observer = new MutationObserver(check);

  observer.observe(container, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [GROWI_IS_CONTENT_RENDERING_ATTR],
  });

  // Initial check so a container with no rendering elements settles immediately.
  check();

  const watchTimeoutId = window.setTimeout(() => {
    if (stopped) return;
    // Mirror watchRenderingAndReScroll: stop observing before firing the
    // fallback, so a widget that never settles cannot cause any further
    // callbacks past this point.
    const shouldFire = !isSettled;
    cleanup();
    if (shouldFire) onSettle();
  }, WATCH_TIMEOUT_MS);

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
