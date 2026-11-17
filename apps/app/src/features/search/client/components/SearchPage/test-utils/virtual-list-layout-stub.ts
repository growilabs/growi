import { act } from '@testing-library/react';
import { vi } from 'vitest';

// happy-dom performs no layout: every offsetHeight/offsetTop is 0 and its
// ResizeObserver never fires. @tanstack/react-virtual sizes the viewport from
// the scroll element's offsetHeight and each row from its offsetHeight (rows
// are identified by `data-index`), and SearchResultList reads the list start
// (scrollMargin) from its container's offsetTop. Stubbing those three is
// enough to make the rendered range deterministic.

// Matches SearchPageBase's scroll container, so the same stub also works when
// the real SearchPageBase provides the scroll element.
const SCROLL_ELEMENT_CLASS = 'overflow-y-scroll';
const LIST_SELECTOR = '[data-testid="search-result-list"]';

// @tanstack/virtual-core resets its "is scrolling" state with a debounced timer
// (isScrollingResetDelay, 150ms by default) that unmounting does not cancel. If
// it fires after the test environment is torn down, React reaches for the
// removed `window` and Vitest reports an unhandled error, so wait it out.
const SCROLL_END_WAIT_MS = 200;

type VirtualListLayout = {
  viewportHeight: number;
  rowHeight: number;
  // Height of whatever sits above the list inside the scroll element.
  listOffsetTop?: number;
};

export type VirtualListLayoutStub = {
  // Attached to document.body; pass it to SearchResultList as `scrollElement`.
  scrollElement: HTMLDivElement;
  // Scrolls the scroll element as a user would, letting the list re-render,
  // and resolves once the virtualizer's scroll-end timer has fired.
  scrollTo: (scrollTop: number) => Promise<void>;
  restore: () => void;
};

export const stubVirtualListLayout = ({
  viewportHeight,
  rowHeight,
  listOffsetTop = 0,
}: VirtualListLayout): VirtualListLayoutStub => {
  const offsetHeightSpy = vi
    .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
    .mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains(SCROLL_ELEMENT_CLASS)) {
        return viewportHeight;
      }
      return this.hasAttribute('data-index') ? rowHeight : 0;
    });

  const offsetTopSpy = vi
    .spyOn(HTMLElement.prototype, 'offsetTop', 'get')
    .mockImplementation(function (this: HTMLElement) {
      return this.firstElementChild?.matches(LIST_SELECTOR) ? listOffsetTop : 0;
    });

  const scrollElement = document.createElement('div');
  scrollElement.className = SCROLL_ELEMENT_CLASS;
  document.body.appendChild(scrollElement);

  return {
    scrollElement,
    scrollTo: async (scrollTop) => {
      act(() => {
        scrollElement.scrollTop = scrollTop;
        scrollElement.dispatchEvent(new Event('scroll'));
      });
      // Same timer queue as the virtualizer (its targetWindow), so this fires
      // after the scroll-end timer scheduled above.
      const targetWindow = scrollElement.ownerDocument.defaultView ?? window;
      await act(async () => {
        await new Promise<void>((resolve) => {
          targetWindow.setTimeout(resolve, SCROLL_END_WAIT_MS);
        });
      });
    },
    restore: () => {
      offsetHeightSpy.mockRestore();
      offsetTopSpy.mockRestore();
      scrollElement.remove();
    },
  };
};
