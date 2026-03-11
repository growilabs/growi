import { useEffect } from 'react';
import {
  GROWI_RENDERING_ATTR,
  GROWI_RENDERING_ATTR_SELECTOR,
} from '@growi/core/dist/consts';

const RENDERING_POLL_INTERVAL_MS = 5000;
const WATCH_TIMEOUT_MS = 10000;

/**
 * Watch for `data-growi-rendering` elements in the container.
 * While any exist, wait 5 seconds then re-scroll to the target.
 * Repeats until no rendering elements remain.
 * A MutationObserver re-triggers the check when new elements appear.
 * Returns a cleanup function.
 */
export const watchRenderingAndReScroll = (
  contentContainer: HTMLElement,
  scrollToTarget: () => boolean,
): (() => void) => {
  let timerId: number | undefined;

  const cleanup = () => {
    observer.disconnect();
    if (timerId != null) {
      window.clearTimeout(timerId);
    }
    window.clearTimeout(watchTimeoutId);
  };

  const checkAndSchedule = () => {
    // If a timer is already ticking, let it fire — don't reset.
    // Resetting on every DOM mutation would prevent the scroll
    // from ever executing when rendering completes quickly.
    if (timerId != null) return;

    const hasRendering =
      contentContainer.querySelector(GROWI_RENDERING_ATTR_SELECTOR) != null;

    if (hasRendering) {
      timerId = window.setTimeout(() => {
        timerId = undefined;
        scrollToTarget();
        checkAndSchedule();
      }, RENDERING_POLL_INTERVAL_MS);
    }
  };

  const observer = new MutationObserver(checkAndSchedule);

  observer.observe(contentContainer, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [GROWI_RENDERING_ATTR],
  });

  // Initial check
  checkAndSchedule();

  // Stop watching after timeout regardless of rendering state
  const watchTimeoutId = window.setTimeout(cleanup, WATCH_TIMEOUT_MS);

  return cleanup;
};

/**
 * Auto-scroll to the URL hash target when the page loads.
 * Handles lazy-rendered content by polling for `data-growi-rendering`
 * elements and re-scrolling after they finish.
 */
export const useHashAutoScroll = (
  pageId: string | undefined | null,
  contentContainerId: string,
): void => {
  useEffect(() => {
    if (pageId == null) return;

    const { hash } = window.location;
    if (hash.length === 0) return;

    const contentContainer = document.getElementById(contentContainerId);
    if (contentContainer == null) return;

    const targetId = decodeURIComponent(hash.slice(1));

    const scrollToTarget = (): boolean => {
      const target = document.getElementById(targetId);
      if (target == null) return false;
      target.scrollIntoView();
      return true;
    };

    // Target already in DOM — scroll and watch rendering
    if (scrollToTarget()) {
      return watchRenderingAndReScroll(contentContainer, scrollToTarget);
    }

    // Target not in DOM yet — wait for it, then watch rendering
    let renderingCleanup: (() => void) | undefined;

    const observer = new MutationObserver(() => {
      if (scrollToTarget()) {
        observer.disconnect();
        window.clearTimeout(timeoutId);
        renderingCleanup = watchRenderingAndReScroll(
          contentContainer,
          scrollToTarget,
        );
      }
    });

    observer.observe(contentContainer, { childList: true, subtree: true });
    const timeoutId = window.setTimeout(
      () => observer.disconnect(),
      WATCH_TIMEOUT_MS,
    );

    return () => {
      observer.disconnect();
      window.clearTimeout(timeoutId);
      renderingCleanup?.();
    };
  }, [pageId, contentContainerId]);
};
