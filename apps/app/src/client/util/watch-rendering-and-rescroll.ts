import {
  GROWI_IS_CONTENT_RENDERING_ATTR,
  GROWI_IS_CONTENT_RENDERING_SELECTOR,
} from '@growi/core/dist/consts';

const RENDERING_POLL_INTERVAL_MS = 5000;
export const WATCH_TIMEOUT_MS = 10000;

/**
 * Watch for elements with in-progress rendering status in the container.
 * Periodically calls scrollToTarget while rendering elements remain, and
 * performs a final re-scroll when the last rendering element completes
 * to compensate for the trailing layout shift (Requirements 3.1–3.3).
 * Returns a cleanup function that stops observation and clears timers.
 */
export const watchRenderingAndReScroll = (
  contentContainer: HTMLElement,
  scrollToTarget: () => boolean,
): (() => void) => {
  let timerId: number | undefined;
  let stopped = false;
  let wasRendering = false;

  const cleanup = () => {
    stopped = true;
    observer.disconnect();
    if (timerId != null) {
      window.clearTimeout(timerId);
      timerId = undefined;
    }
    window.clearTimeout(watchTimeoutId);
  };

  const checkAndSchedule = () => {
    if (stopped) return;

    const hasRendering =
      contentContainer.querySelector(GROWI_IS_CONTENT_RENDERING_SELECTOR) !=
      null;

    if (!hasRendering) {
      if (timerId != null) {
        window.clearTimeout(timerId);
        timerId = undefined;
      }
      // Final re-scroll to compensate for the layout shift from the last completed render
      if (wasRendering) {
        wasRendering = false;
        scrollToTarget();
      }
      return;
    }

    wasRendering = true;

    // If a timer is already ticking, let it fire — don't reset
    if (timerId != null) return;

    timerId = window.setTimeout(() => {
      if (stopped) return;
      timerId = undefined;
      // Reset before checkAndSchedule so the wasRendering guard does not
      // trigger an extra re-scroll if rendering is already done by now.
      wasRendering = false;
      scrollToTarget();
      checkAndSchedule();
    }, RENDERING_POLL_INTERVAL_MS);
  };

  const observer = new MutationObserver(checkAndSchedule);

  observer.observe(contentContainer, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [GROWI_IS_CONTENT_RENDERING_ATTR],
  });

  // Initial check
  checkAndSchedule();

  // Stop watching after timeout regardless of rendering state
  const watchTimeoutId = window.setTimeout(cleanup, WATCH_TIMEOUT_MS);

  return cleanup;
};
