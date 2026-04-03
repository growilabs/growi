import { useEffect, useRef } from 'react';
import { GROWI_IS_CONTENT_RENDERING_SELECTOR } from '@growi/core/dist/consts';

import {
  WATCH_TIMEOUT_MS,
  watchRenderingAndReScroll,
} from './watch-rendering-and-rescroll';

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
