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

type VirtualListLayout = {
  viewportHeight: number;
  rowHeight: number;
  // Height of whatever sits above the list inside the scroll element.
  listOffsetTop?: number;
};

export type VirtualListLayoutStub = {
  // Attached to document.body; pass it to SearchResultList as `scrollElement`.
  scrollElement: HTMLDivElement;
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
    restore: () => {
      offsetHeightSpy.mockRestore();
      offsetTopSpy.mockRestore();
      scrollElement.remove();
    },
  };
};
