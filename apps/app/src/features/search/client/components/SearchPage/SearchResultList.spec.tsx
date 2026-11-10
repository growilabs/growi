import React from 'react';
import type { IPageHasId } from '@growi/core';
import type { IPageInfoForListing } from '@growi/core/dist/interfaces';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type {
  ISelectable,
  ISelectableAll,
} from '~/client/interfaces/selectable-all';
import type { IPageWithSearchMeta } from '~/interfaces/search';

// --- Capture the props PageListItemL receives, and allow invoking its
// duplicate/rename/delete callbacks from the test (SearchResultList owns the
// wiring under test; the row component itself is exercised by its own spec).
type CapturedPageListItemLProps = {
  page: IPageWithSearchMeta;
  listItemRef?: React.Ref<HTMLLIElement>;
  listItemIndex?: number;
  listSize?: number;
  isSelected?: boolean;
  isInitiallyChecked?: boolean;
  onPageDuplicated?: (fromPath: string, toPath: string) => void;
  onPageRenamed?: (path: string, newPath: string) => void;
  onPageDeleted?: (
    path: string | string[],
    isRecursively?: boolean,
    isCompletely?: boolean,
  ) => void;
};

const pageListItemLSpy = vi.hoisted(() => ({
  // Keyed by page id so multi-row tests can invoke a SPECIFIC row's callbacks
  // (e.g. "delete row b while row a is previewed") without one row's props
  // clobbering another's.
  propsByPageId: new Map<string, CapturedPageListItemLProps>(),
  renderCountByPageId: new Map<string, number>(),
  selectCallsByPageId: new Map<string, number>(),
  deselectCallsByPageId: new Map<string, number>(),
  get lastProps(): CapturedPageListItemLProps | undefined {
    return [...pageListItemLSpy.propsByPageId.values()].at(-1);
  },
  clear(): void {
    pageListItemLSpy.propsByPageId.clear();
    pageListItemLSpy.renderCountByPageId.clear();
    pageListItemLSpy.selectCallsByPageId.clear();
    pageListItemLSpy.deselectCallsByPageId.clear();
  },
}));

const increment = (counts: Map<string, number>, pageId: string): void => {
  counts.set(pageId, (counts.get(pageId) ?? 0) + 1);
};

// Mirrors the real component's `memo(forwardRef(...))`: a row re-renders only
// when one of its props (including `ref`) changes identity.
vi.mock('~/client/components/PageList/PageListItemL', () => ({
  PageListItemL: React.memo(
    React.forwardRef(
      (props: CapturedPageListItemLProps, ref: React.Ref<ISelectable>) => {
        const pageId = props.page.data._id;
        pageListItemLSpy.propsByPageId.set(pageId, props);
        increment(pageListItemLSpy.renderCountByPageId, pageId);
        const checkboxRef = React.useRef<HTMLInputElement>(null);
        React.useImperativeHandle(ref, () => ({
          select: () => {
            increment(pageListItemLSpy.selectCallsByPageId, pageId);
            if (checkboxRef.current != null) {
              checkboxRef.current.checked = true;
            }
          },
          deselect: () => {
            increment(pageListItemLSpy.deselectCallsByPageId, pageId);
            if (checkboxRef.current != null) {
              checkboxRef.current.checked = false;
            }
          },
        }));
        // A real <li> so the virtualizer can measure the row. Like the real
        // row, the checkbox is uncontrolled (its initial state comes from
        // `isInitiallyChecked`) and `isSelected` shows as the `active` class.
        return (
          <li
            ref={props.listItemRef}
            data-index={props.listItemIndex}
            aria-setsize={props.listSize}
            className={props.isSelected ? 'active' : undefined}
          >
            <input
              ref={checkboxRef}
              type="checkbox"
              aria-label={pageId}
              defaultChecked={props.isInitiallyChecked}
            />
          </li>
        );
      },
    ),
  ),
}));

const pageInfoStub = vi.hoisted(() => ({
  idToPageInfo: undefined as Record<string, unknown> | undefined,
}));

vi.mock('~/stores/page-listing', () => ({
  mutatePageTree: vi.fn(),
  mutateRecentlyUpdated: vi.fn(),
  useSWRxPageInfoForList: vi.fn(() => ({ data: pageInfoStub.idToPageInfo })),
}));

const mutateSearchingSpy = vi.hoisted(() => vi.fn());
vi.mock('~/stores/search', () => ({
  mutateSearching: mutateSearchingSpy,
}));

vi.mock('~/states/context', () => ({
  useIsGuestUser: vi.fn(() => false),
  useIsReadOnlyUser: vi.fn(() => false),
}));

vi.mock('~/client/util/toastr', () => ({
  toastSuccess: vi.fn(),
}));

// Stable across renders like the real (memoized) `t`, so handlers depending on
// it keep their identity and the row memo can be observed.
const translate = vi.hoisted(() => (key: string) => key);
vi.mock('next-i18next', () => ({
  useTranslation: vi.fn(() => ({ t: translate })),
}));

import { SearchResultList } from './SearchResultList';
import {
  stubVirtualListLayout,
  type VirtualListLayoutStub,
} from './test-utils/virtual-list-layout-stub';

// Tall enough that every row of the small lists below is rendered.
let layout: VirtualListLayoutStub;
beforeEach(() => {
  layout = stubVirtualListLayout({ viewportHeight: 1000, rowHeight: 50 });
});
afterEach(() => {
  layout.restore();
});

const createPage = (id: string): IPageWithSearchMeta =>
  mock<IPageWithSearchMeta>({
    data: mock<IPageHasId>({ _id: id, path: `/page/${id}` }),
  });

// A-1: mutateSearching()'s filtered mutate() never reaches an active
// useSWRInfinite subscription (SWR skips `$inf$`-prefixed keys), so the
// infinite-scroll page applies each row change to its own cache. These tests
// pin the contract that SearchResultList reports WHAT changed (in addition to
// mutateSearching()), so the caller can update rows without re-fetching.
describe('SearchResultList item-mutation wiring (A-1)', () => {
  beforeEach(() => {
    pageListItemLSpy.clear();
    vi.clearAllMocks();
  });

  it('reports the old and new path when a page is renamed', () => {
    const onItemMutated = vi.fn();
    render(
      <SearchResultList
        scrollElement={layout.scrollElement}
        pages={[createPage('a')]}
        onItemMutated={onItemMutated}
      />,
    );

    pageListItemLSpy.lastProps?.onPageRenamed?.('/page/a', '/moved/a');

    expect(mutateSearchingSpy).toHaveBeenCalledTimes(1);
    expect(onItemMutated).toHaveBeenCalledExactlyOnceWith({
      type: 'renamed',
      fromPath: '/page/a',
      toPath: '/moved/a',
    });
  });

  it('reports the deleted path and whether descendants were deleted too', () => {
    const onItemMutated = vi.fn();
    render(
      <SearchResultList
        scrollElement={layout.scrollElement}
        pages={[createPage('a')]}
        onItemMutated={onItemMutated}
      />,
    );

    pageListItemLSpy.lastProps?.onPageDeleted?.('/page/a', true, false);

    expect(mutateSearchingSpy).toHaveBeenCalledTimes(1);
    expect(onItemMutated).toHaveBeenCalledExactlyOnceWith({
      type: 'deleted',
      path: '/page/a',
      isRecursively: true,
    });
  });

  it('reports a non-recursive delete as such', () => {
    const onItemMutated = vi.fn();
    render(
      <SearchResultList
        scrollElement={layout.scrollElement}
        pages={[createPage('a')]}
        onItemMutated={onItemMutated}
      />,
    );

    pageListItemLSpy.lastProps?.onPageDeleted?.('/page/a', false, false);

    expect(onItemMutated).toHaveBeenCalledExactlyOnceWith({
      type: 'deleted',
      path: '/page/a',
      isRecursively: false,
    });
  });

  it('does not report a duplication, which changes no existing row', () => {
    const onItemMutated = vi.fn();
    render(
      <SearchResultList
        scrollElement={layout.scrollElement}
        pages={[createPage('a')]}
        onItemMutated={onItemMutated}
      />,
    );

    pageListItemLSpy.lastProps?.onPageDuplicated?.('/page/a', '/page/a-copy');

    expect(mutateSearchingSpy).toHaveBeenCalledTimes(1);
    expect(onItemMutated).not.toHaveBeenCalled();
  });

  it('does not throw when onItemMutated is not provided (legacy callers)', () => {
    render(
      <SearchResultList
        scrollElement={layout.scrollElement}
        pages={[createPage('a')]}
      />,
    );

    expect(() =>
      pageListItemLSpy.lastProps?.onPageDeleted?.('/deleted', false, false),
    ).not.toThrow();
    expect(mutateSearchingSpy).toHaveBeenCalledTimes(1);
  });
});

// The right-pane preview (`selectedPageWithMeta`) is a snapshot object held
// independently of `pages`, so revalidating the list after a delete removes
// the row but never clears a preview pointing at data that no longer exists.
// Deleting the row currently shown in the preview must explicitly signal the
// caller to clear it.
describe('SearchResultList onPreviewedPageDeleted wiring', () => {
  beforeEach(() => {
    pageListItemLSpy.clear();
    vi.clearAllMocks();
  });

  it('calls onPreviewedPageDeleted when the deleted row is the previewed page', () => {
    const onPreviewedPageDeleted = vi.fn();
    render(
      <SearchResultList
        scrollElement={layout.scrollElement}
        pages={[createPage('a'), createPage('b')]}
        selectedPageId="b"
        onPreviewedPageDeleted={onPreviewedPageDeleted}
      />,
    );

    pageListItemLSpy.propsByPageId
      .get('b')
      ?.onPageDeleted?.('/page/b', false, false);

    expect(onPreviewedPageDeleted).toHaveBeenCalledTimes(1);
  });

  it('does not call onPreviewedPageDeleted when a different row is deleted', () => {
    const onPreviewedPageDeleted = vi.fn();
    render(
      <SearchResultList
        scrollElement={layout.scrollElement}
        pages={[createPage('a'), createPage('b')]}
        selectedPageId="b"
        onPreviewedPageDeleted={onPreviewedPageDeleted}
      />,
    );

    pageListItemLSpy.propsByPageId
      .get('a')
      ?.onPageDeleted?.('/page/a', false, false);

    expect(onPreviewedPageDeleted).not.toHaveBeenCalled();
  });

  it('does not call onPreviewedPageDeleted when no page is previewed', () => {
    const onPreviewedPageDeleted = vi.fn();
    render(
      <SearchResultList
        scrollElement={layout.scrollElement}
        pages={[createPage('a')]}
        onPreviewedPageDeleted={onPreviewedPageDeleted}
      />,
    );

    pageListItemLSpy.propsByPageId
      .get('a')
      ?.onPageDeleted?.('/page/a', false, false);

    expect(onPreviewedPageDeleted).not.toHaveBeenCalled();
  });
});

// Req 10.1: switching the previewed page must not re-render unrelated rows.
// PageListItemL is memo'd, so this holds only while every prop SearchResultList
// passes to a row (page, ref, handlers) keeps its identity across the switch.
describe('SearchResultList row re-render scope on preview switch (Req 10.1)', () => {
  const pages = ['a', 'b', 'c', 'd'].map(createPage);

  beforeEach(() => {
    pageListItemLSpy.clear();
    pageInfoStub.idToPageInfo = undefined;
    vi.clearAllMocks();
  });

  const switchPreviewAndCountRenders = (): Record<string, number> => {
    const { rerender } = render(
      <SearchResultList
        scrollElement={layout.scrollElement}
        pages={pages}
        selectedPageId="a"
      />,
    );
    pageListItemLSpy.renderCountByPageId.clear();

    rerender(
      <SearchResultList
        scrollElement={layout.scrollElement}
        pages={pages}
        selectedPageId="c"
      />,
    );

    return Object.fromEntries(pageListItemLSpy.renderCountByPageId);
  };

  it('re-renders only the previously and newly previewed rows', () => {
    expect(switchPreviewAndCountRenders()).toEqual({ a: 1, c: 1 });
  });

  it('re-renders only those two rows when page info is injected into rows', () => {
    pageInfoStub.idToPageInfo = Object.fromEntries(
      pages.map((page) => [
        page.data._id,
        mock<IPageInfoForListing>({ isEmpty: false, revisionShortBody: '' }),
      ]),
    );

    expect(switchPreviewAndCountRenders()).toEqual({ a: 1, c: 1 });
  });

  // A re-rendered row's ref is detached and re-attached (no-deps
  // useImperativeHandle), so a row touched by one switch must still skip
  // re-rendering on the following switches.
  it('keeps re-rendering only the two affected rows across repeated switches', () => {
    const { rerender } = render(
      <SearchResultList
        scrollElement={layout.scrollElement}
        pages={pages}
        selectedPageId="a"
      />,
    );
    const switchTo = (selectedPageId: string): Record<string, number> => {
      pageListItemLSpy.renderCountByPageId.clear();
      rerender(
        <SearchResultList
          scrollElement={layout.scrollElement}
          pages={pages}
          selectedPageId={selectedPageId}
        />,
      );
      return Object.fromEntries(pageListItemLSpy.renderCountByPageId);
    };

    expect(switchTo('c')).toEqual({ a: 1, c: 1 });
    expect(switchTo('b')).toEqual({ c: 1, b: 1 });
    expect(switchTo('d')).toEqual({ b: 1, d: 1 });
  });
});

describe('SearchResultList selectAll / deselectAll', () => {
  beforeEach(() => {
    pageListItemLSpy.clear();
    pageInfoStub.idToPageInfo = undefined;
    vi.clearAllMocks();
  });

  it('selects and deselects every mounted row', () => {
    const ref = React.createRef<ISelectableAll>();
    render(
      <SearchResultList
        scrollElement={layout.scrollElement}
        ref={ref}
        pages={['a', 'b', 'c'].map(createPage)}
      />,
    );

    ref.current?.selectAll();
    ref.current?.deselectAll();

    const expected = { a: 1, b: 1, c: 1 };
    expect(Object.fromEntries(pageListItemLSpy.selectCallsByPageId)).toEqual(
      expected,
    );
    expect(Object.fromEntries(pageListItemLSpy.deselectCallsByPageId)).toEqual(
      expected,
    );
  });

  it('no longer reaches a row after it is removed from the list', () => {
    const ref = React.createRef<ISelectableAll>();
    const [a, b, c] = ['a', 'b', 'c'].map(createPage);
    const { rerender } = render(
      <SearchResultList
        scrollElement={layout.scrollElement}
        ref={ref}
        pages={[a, b, c]}
      />,
    );

    rerender(
      <SearchResultList
        scrollElement={layout.scrollElement}
        ref={ref}
        pages={[a, c]}
      />,
    );
    ref.current?.selectAll();

    expect(Object.fromEntries(pageListItemLSpy.selectCallsByPageId)).toEqual({
      a: 1,
      c: 1,
    });
  });
});

// Req 8.1/8.2/8.4: only the viewport plus a fixed overscan is rendered, while
// the list keeps the full height of every loaded row.
describe('SearchResultList virtualization', () => {
  const VIEWPORT_HEIGHT = 500;
  const ROW_HEIGHT = 50;
  const ROWS_IN_VIEWPORT = VIEWPORT_HEIGHT / ROW_HEIGHT;

  const createPages = (count: number): IPageWithSearchMeta[] =>
    Array.from({ length: count }, (_, i) => createPage(`p${i}`));

  beforeEach(() => {
    pageListItemLSpy.clear();
    pageInfoStub.idToPageInfo = undefined;
    vi.clearAllMocks();
    // Replace the roomy default layout with a small viewport; the top-level
    // afterEach restores whichever stub `layout` holds.
    layout.restore();
    layout = stubVirtualListLayout({
      viewportHeight: VIEWPORT_HEIGHT,
      rowHeight: ROW_HEIGHT,
    });
  });

  it('renders only the rows around the viewport out of several hundred', () => {
    render(
      <SearchResultList
        scrollElement={layout.scrollElement}
        pages={createPages(300)}
      />,
    );

    const rowCount = screen.getAllByRole('listitem').length;
    expect(rowCount).toBeGreaterThanOrEqual(ROWS_IN_VIEWPORT);
    expect(rowCount).toBeLessThan(ROWS_IN_VIEWPORT * 3);
  });

  it('does not render more rows when more pages are loaded', () => {
    const { rerender } = render(
      <SearchResultList
        scrollElement={layout.scrollElement}
        pages={createPages(300)}
      />,
    );
    const rowCountBefore = screen.getAllByRole('listitem').length;

    rerender(
      <SearchResultList
        scrollElement={layout.scrollElement}
        pages={createPages(600)}
      />,
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(rowCountBefore);
  });

  it('sizes the list to every loaded row, measured or estimated', () => {
    // Unrendered rows count as the rows' CSS min-height (_page_list.scss).
    const CSS_MIN_ROW_HEIGHT = 136;
    const pageCount = 300;
    render(
      <SearchResultList
        selectedPageIds={NO_SELECTION}
        scrollElement={layout.scrollElement}
        pages={createPages(pageCount)}
      />,
    );

    const measuredRowCount = screen.getAllByRole('listitem').length;
    const container = screen.getByTestId('search-result-list').parentElement;
    expect(container?.style.height).toBe(
      `${
        measuredRowCount * ROW_HEIGHT +
        (pageCount - measuredRowCount) * CSS_MIN_ROW_HEIGHT
      }px`,
    );
  });

  it('accounts for the content above the list when choosing rows', () => {
    const renderRowCount = (): number => {
      const { unmount } = render(
        <SearchResultList
          scrollElement={layout.scrollElement}
          pages={createPages(300)}
        />,
      );
      const rowCount = screen.getAllByRole('listitem').length;
      unmount();
      return rowCount;
    };
    const rowCountWithoutHeader = renderRowCount();

    layout.restore();
    const headerHeight = ROW_HEIGHT * 4;
    layout = stubVirtualListLayout({
      viewportHeight: VIEWPORT_HEIGHT,
      rowHeight: ROW_HEIGHT,
      listOffsetTop: headerHeight,
    });

    expect(renderRowCount()).toBe(
      rowCountWithoutHeader - headerHeight / ROW_HEIGHT,
    );
  });

  it('gives each row the list size from listSize, or the loaded count by default', () => {
    const pages = createPages(30);
    const setSizesOfRows = (): string[] =>
      screen
        .getAllByRole('listitem')
        .map((row) => row.getAttribute('aria-setsize') ?? '');

    const { rerender } = render(
      <SearchResultList scrollElement={layout.scrollElement} pages={pages} />,
    );
    expect(new Set(setSizesOfRows())).toEqual(new Set(['30']));

    rerender(
      <SearchResultList
        scrollElement={layout.scrollElement}
        pages={pages}
        listSize={-1}
      />,
    );
    expect(new Set(setSizesOfRows())).toEqual(new Set(['-1']));
  });

  it('renders no rows until the scroll element is available', () => {
    const pages = createPages(3);
    const { rerender } = render(
      <SearchResultList scrollElement={null} pages={pages} />,
    );

    expect(screen.queryAllByRole('listitem')).toHaveLength(0);

    rerender(
      <SearchResultList scrollElement={layout.scrollElement} pages={pages} />,
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });
});

// Req 9.1/9.2/9.4: a row scrolled out of the rendered range is unmounted, so
// its checkbox and preview highlight must be restored when it is rendered again.
describe('SearchResultList state of rows re-rendered by scrolling', () => {
  const VIEWPORT_HEIGHT = 500;
  const ROW_HEIGHT = 50;
  const pages = Array.from({ length: 300 }, (_, i) => createPage(`p${i}`));
  // Far enough that the first rows (and their overscan) leave the range.
  const FAR_SCROLL_TOP = ROW_HEIGHT * 100;

  beforeEach(() => {
    pageListItemLSpy.clear();
    pageInfoStub.idToPageInfo = undefined;
    vi.clearAllMocks();
    layout.restore();
    layout = stubVirtualListLayout({
      viewportHeight: VIEWPORT_HEIGHT,
      rowHeight: ROW_HEIGHT,
    });
  });

  const checkboxOf = (pageId: string): HTMLInputElement =>
    screen.getByRole('checkbox', { name: pageId });

  const listItemOf = (pageId: string): HTMLElement | null =>
    checkboxOf(pageId).closest('li');

  it('renders rows in the selected set checked and the others unchecked', () => {
    render(
      <SearchResultList
        scrollElement={layout.scrollElement}
        pages={pages}
        selectedPageIds={new Set(['p1'])}
      />,
    );

    expect(checkboxOf('p1')).toBeChecked();
    expect(checkboxOf('p2')).not.toBeChecked();
  });

  it('keeps a checked row checked and an unchecked row unchecked after scrolling out and back', async () => {
    render(
      <SearchResultList
        scrollElement={layout.scrollElement}
        pages={pages}
        selectedPageIds={new Set(['p1'])}
      />,
    );

    await layout.scrollTo(FAR_SCROLL_TOP);
    expect(screen.queryByRole('checkbox', { name: 'p1' })).toBeNull();
    await layout.scrollTo(0);

    expect(checkboxOf('p1')).toBeChecked();
    expect(checkboxOf('p2')).not.toBeChecked();
  });

  it('keeps the preview highlight on the previewed row after scrolling out and back', async () => {
    render(
      <SearchResultList
        scrollElement={layout.scrollElement}
        pages={pages}
        selectedPageId="p1"
      />,
    );

    await layout.scrollTo(FAR_SCROLL_TOP);
    expect(screen.queryByRole('checkbox', { name: 'p1' })).toBeNull();
    await layout.scrollTo(0);

    expect(listItemOf('p1')).toHaveClass('active');
    expect(listItemOf('p2')).not.toHaveClass('active');
  });

  it('renders rows checked that are first rendered by scrolling after selectAll', async () => {
    const ref = React.createRef<ISelectableAll>();
    // Kept as the same instance and updated by the caller, as SearchPageBase does.
    const selectedPageIds = new Set<string>();
    render(
      <SearchResultList
        scrollElement={layout.scrollElement}
        ref={ref}
        pages={pages}
        selectedPageIds={selectedPageIds}
      />,
    );
    const renderedPageIds = (): string[] =>
      screen
        .getAllByRole('checkbox')
        .map((checkbox) => checkbox.getAttribute('aria-label') ?? '');
    const initiallyRenderedPageIds = new Set(renderedPageIds());

    ref.current?.selectAll();
    pages.forEach((page) => {
      selectedPageIds.add(page.data._id);
    });
    await layout.scrollTo(FAR_SCROLL_TOP);

    const newlyRenderedPageIds = renderedPageIds().filter(
      (pageId) => !initiallyRenderedPageIds.has(pageId),
    );
    expect(newlyRenderedPageIds.length).toBeGreaterThan(0);
    newlyRenderedPageIds.forEach((pageId) => {
      expect(checkboxOf(pageId)).toBeChecked();
    });
  });
});
