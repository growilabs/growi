import { useEffect, useRef } from 'react';
import {
  GROWI_IS_CONTENT_RENDERING_ATTR,
  GROWI_IS_CONTENT_RENDERING_SELECTOR,
} from '@growi/core/dist/consts';

const RENDERING_POLL_INTERVAL_MS = 5000;
const WATCH_TIMEOUT_MS = 10000;

/**
 * Watch for elements with in-progress rendering status in the container.
 * Periodically calls scrollToTarget while rendering elements remain.
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

/** Configuration for the auto-scroll hook */
export interface UseContentAutoScrollOptions {
  /**
   * Unique key that triggers re-execution when changed.
   * When null/undefined, all scroll processing is skipped.
   */
  key: string | undefined | null;

  /** DOM id of the content container element to observe */
  contentContainerId: string;

  /**
   * Optional function to resolve the scroll target element.
   * Receives the decoded hash string (without '#').
   * Defaults to: (hash) => document.getElementById(hash)
   */
  resolveTarget?: (decodedHash: string) => HTMLElement | null;

  /**
   * Optional function to scroll to the target element.
   * Defaults to: (el) => el.scrollIntoView()
   */
  scrollTo?: (target: HTMLElement) => void;
}

/**
 * Auto-scroll to the URL hash target when a content view loads.
 * Handles lazy-rendered content by polling for rendering-status
 * attributes and re-scrolling after they finish.
 */
export const useContentAutoScroll = (
  options: UseContentAutoScrollOptions,
): void => {
  const { key, contentContainerId } = options;
  const resolveTargetRef = useRef(options.resolveTarget);
  resolveTargetRef.current = options.resolveTarget;
  const scrollToRef = useRef(options.scrollTo);
  scrollToRef.current = options.scrollTo;

  useEffect(() => {
    if (key == null) return;

    const { hash } = window.location;
    if (hash.length === 0) return;

    const contentContainer = document.getElementById(contentContainerId);
    if (contentContainer == null) return;

    const targetId = decodeURIComponent(hash.slice(1));

    const scrollToTarget = (): boolean => {
      const resolve =
        resolveTargetRef.current ??
        ((id: string) => document.getElementById(id));
      const target = resolve(targetId);
      if (target == null) return false;
      const scroll =
        scrollToRef.current ?? ((el: HTMLElement) => el.scrollIntoView());
      scroll(target);
      return true;
    };

    const hasRenderingElements = (): boolean => {
      return (
        contentContainer.querySelector(GROWI_IS_CONTENT_RENDERING_SELECTOR) !=
        null
      );
    };

    const startRenderingWatchIfNeeded = (): (() => void) | undefined => {
      if (hasRenderingElements()) {
        return watchRenderingAndReScroll(contentContainer, scrollToTarget);
      }
      return undefined;
    };

    // Target already in DOM — scroll and optionally watch rendering
    if (scrollToTarget()) {
      const renderingCleanup = startRenderingWatchIfNeeded();
      return () => {
        renderingCleanup?.();
      };
    }

    // Target not in DOM yet — wait for it, then optionally watch rendering
    let renderingCleanup: (() => void) | undefined;

    const observer = new MutationObserver(() => {
      if (scrollToTarget()) {
        observer.disconnect();
        window.clearTimeout(timeoutId);
        renderingCleanup = startRenderingWatchIfNeeded();
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
  }, [key, contentContainerId]);
};
