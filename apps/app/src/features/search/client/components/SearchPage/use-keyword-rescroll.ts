import { type RefObject, useEffect } from 'react';
import { debounce } from 'throttle-debounce';

import { scrollWithinContainer } from '~/client/util/smooth-scroll';
import { watchRenderingAndReScroll } from '~/client/util/watch-rendering-and-rescroll';

const SCROLL_OFFSET_TOP = 30;
const MUTATION_OBSERVER_CONFIG = { childList: true, subtree: true };

const scrollToTargetWithinContainer = (
  target: HTMLElement,
  container: HTMLElement,
): void => {
  const distance =
    target.getBoundingClientRect().top -
    container.getBoundingClientRect().top -
    SCROLL_OFFSET_TOP;
  scrollWithinContainer(container, distance);
};

/**
 * Scroll to the first `.highlighted-keyword` element inside the given container.
 * @returns true if an element was found and scrolled to, false otherwise.
 */
const scrollToKeyword = (scrollElement: HTMLElement): boolean => {
  // use querySelector to intentionally get the first element found
  const toElem = scrollElement.querySelector(
    '.highlighted-keyword',
  ) as HTMLElement | null;
  if (toElem == null) return false;
  scrollToTargetWithinContainer(toElem, scrollElement);
  return true;
};

export interface UseKeywordRescrollOptions {
  /** Ref to the scrollable container element */
  scrollElementRef: RefObject<HTMLElement | null>;
  /** Unique key that triggers re-execution (typically page._id) */
  key: string;
}

/**
 * Watches for keyword highlights in the scroll container and scrolls to the first one.
 * Also integrates with the rendering watch to re-scroll after async renderer layout shifts.
 */
export const useKeywordRescroll = ({
  scrollElementRef,
  key,
}: UseKeywordRescrollOptions): void => {
  // biome-ignore lint/correctness/useExhaustiveDependencies: key is a trigger dep — re-run this effect when the selected page changes
  useEffect(() => {
    const scrollElement = scrollElementRef.current;

    if (scrollElement == null) return;

    const scrollToKeywordDebounced = debounce(500, () => {
      scrollToKeyword(scrollElement);
    });

    const observer = new MutationObserver(() => {
      scrollToKeywordDebounced();
    });
    observer.observe(scrollElement, MUTATION_OBSERVER_CONFIG);

    // Re-scroll to keyword after async renderers (drawio/mermaid) cause layout shifts
    const cleanupWatch = watchRenderingAndReScroll(scrollElement, () =>
      scrollToKeyword(scrollElement),
    );

    return () => {
      observer.disconnect();
      scrollToKeywordDebounced.cancel();
      cleanupWatch();
    };
  }, [key]);
};
