import type { JSX } from 'react';
import React, { useState } from 'react';
import type { IPageHasId } from '@growi/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { atom } from 'jotai';
import type { SWRInfiniteResponse } from 'swr/infinite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type { ISelectable } from '~/client/interfaces/selectable-all';
import type {
  IFormattedSearchResult,
  IPageWithSearchMeta,
} from '~/interfaces/search';

// SearchPageBase.spec.tsx mocks SearchResultList for the whole file, so the
// re-render scope across SearchPageBase -> real SearchResultList -> rows is
// verified here. Only the row component is replaced, by a render-counting
// stand-in that keeps the real one's `memo(forwardRef(...))` shape.
type RowProps = {
  page: IPageWithSearchMeta;
  listItemRef?: React.Ref<HTMLLIElement>;
  listItemIndex?: number;
  listSize?: number;
  isSelected?: boolean;
  isInitiallyChecked?: boolean;
  onClickItem?: (pageId: string) => void;
  onCheckboxChanged?: (isChecked: boolean, pageId: string) => void;
};

const rowRenderCounts = vi.hoisted(() => new Map<string, number>());

vi.mock('~/client/components/PageList/PageListItemL', () => ({
  PageListItemL: React.memo(
    React.forwardRef((props: RowProps, ref: React.Ref<ISelectable>) => {
      const pageId = props.page.data._id;
      rowRenderCounts.set(pageId, (rowRenderCounts.get(pageId) ?? 0) + 1);

      const checkboxRef = React.useRef<HTMLInputElement>(null);
      // No deps, like the real row: the ref is detached and re-attached on
      // every re-render of the row.
      React.useImperativeHandle(ref, () => ({
        select: () => {
          if (checkboxRef.current != null) {
            checkboxRef.current.checked = true;
          }
        },
        deselect: () => {
          if (checkboxRef.current != null) {
            checkboxRef.current.checked = false;
          }
        },
      }));

      // The real row calls onClickItem only on large devices; the preview
      // switch is exercised through a dedicated control here. The checkbox is
      // kept outside it so that toggling it is not also a preview switch.
      return (
        <li
          ref={props.listItemRef}
          data-index={props.listItemIndex}
          aria-setsize={props.listSize}
          className={props.isSelected ? 'active' : undefined}
        >
          <button
            type="button"
            aria-label={`preview ${pageId}`}
            onClick={() => props.onClickItem?.(pageId)}
          />
          <input
            ref={checkboxRef}
            type="checkbox"
            aria-label={`select ${pageId}`}
            defaultChecked={props.isInitiallyChecked}
            onChange={(e) =>
              props.onCheckboxChanged?.(e.target.checked, pageId)
            }
          />
        </li>
      );
    }),
  ),
}));

vi.mock('~/states/server-configurations', () => ({
  isSearchServiceConfiguredAtom: atom(true),
  isSearchServiceReachableAtom: atom(true),
}));

vi.mock('~/states/search', () => ({
  useKeywordManager: vi.fn(),
}));

vi.mock('~/states/context', () => ({
  useIsGuestUser: vi.fn(() => false),
  useIsReadOnlyUser: vi.fn(() => false),
}));

vi.mock('~/states/ui/modal/page-delete', () => ({
  usePageDeleteModalActions: vi.fn(() => ({ open: vi.fn() })),
}));

// A stable `data` reference, as SWR returns between renders.
const pageInfoResponse = vi.hoisted(() => ({ data: {} }));
vi.mock('~/stores/page-listing', () => ({
  mutatePageTree: vi.fn(),
  mutateRecentlyUpdated: vi.fn(),
  useSWRxPageInfoForList: vi.fn(() => pageInfoResponse),
}));

vi.mock('~/stores/search', () => ({
  mutateSearching: vi.fn(),
}));

vi.mock('~/client/util/toastr', () => ({
  toastSuccess: vi.fn(),
}));

// Stable across renders like the real (memoized) `t`, so handlers depending on
// it keep their identity.
const translate = vi.hoisted(() => (key: string) => key);
vi.mock('next-i18next', () => ({
  useTranslation: vi.fn(() => ({ t: translate })),
}));

vi.mock('@growi/ui/dist/components', () => ({
  LoadingSpinner: () => null,
}));

// The right-pane preview is irrelevant to row re-rendering.
vi.mock('next/dynamic', () => ({
  default: () => {
    return function MockDynamic() {
      return null;
    };
  },
}));

import { SearchPageBase } from './SearchPageBase';
import {
  stubVirtualListLayout,
  type VirtualListLayoutStub,
} from './test-utils/virtual-list-layout-stub';

const PAGE_IDS = ['a', 'b', 'c', 'd', 'e'];

const createPage = (id: string): IPageWithSearchMeta =>
  mock<IPageWithSearchMeta>({
    data: mock<IPageHasId>({ _id: id, path: `/page/${id}` }),
  });

type InfiniteScrollProps = {
  swrInfiniteResponse: SWRInfiniteResponse<IFormattedSearchResult, Error>;
  isReachingEnd: boolean;
  hasError: boolean;
  onRetry: () => void;
};

const createInfiniteScrollProps = (): InfiniteScrollProps => ({
  swrInfiniteResponse:
    mock<SWRInfiniteResponse<IFormattedSearchResult, Error>>(),
  isReachingEnd: false,
  hasError: false,
  onRetry: vi.fn(),
});

// Emulates SearchPage: the selected count lives in the parent's state, so each
// checkbox change re-renders the parent and, through it, SearchPageBase.
const SearchPageHarness = ({
  pages,
  infiniteScroll,
}: {
  pages: IPageWithSearchMeta[];
  infiniteScroll: InfiniteScrollProps;
}): JSX.Element => {
  const [selectedCount, setSelectedCount] = useState(0);
  return (
    <SearchPageBase
      resetKey="search-1"
      pages={pages}
      infiniteScroll={infiniteScroll}
      onSelectedPagesByCheckboxesChanged={(count) => setSelectedCount(count)}
      searchControl={null}
      searchResultListHead={
        <span data-testid="selected-count">{selectedCount}</span>
      }
    />
  );
};

const renderSearchPage = (): void => {
  render(
    <SearchPageHarness
      pages={PAGE_IDS.map(createPage)}
      infiniteScroll={createInfiniteScrollProps()}
    />,
  );
};

const countRendersDuring = (action: () => void): Record<string, number> => {
  rowRenderCounts.clear();
  act(action);
  return Object.fromEntries(rowRenderCounts);
};

const renderedRowIds = (): string[] =>
  screen
    .getAllByRole('listitem')
    .map((row) => row.querySelector('input')?.getAttribute('aria-label') ?? '');

// Tall enough that every row of the list is rendered.
let layout: VirtualListLayoutStub;
beforeEach(() => {
  rowRenderCounts.clear();
  vi.clearAllMocks();
  layout = stubVirtualListLayout({ viewportHeight: 1000, rowHeight: 50 });
});
afterEach(() => {
  layout.restore();
});

describe('SearchPageBase with the real SearchResultList: row re-render scope', () => {
  it('renders every row, so the re-render assertions below are not vacuous', () => {
    renderSearchPage();

    expect(renderedRowIds()).toEqual(PAGE_IDS.map((id) => `select ${id}`));
    // the first result is previewed initially
    expect(screen.getAllByRole('listitem')[0].className).toBe('active');
  });

  // Req 10.1
  it('re-renders only the previously and newly previewed rows on each preview switch', () => {
    renderSearchPage();

    expect(
      countRendersDuring(() => {
        fireEvent.click(screen.getByRole('button', { name: 'preview c' }));
      }),
    ).toEqual({ a: 1, c: 1 });

    expect(
      countRendersDuring(() => {
        fireEvent.click(screen.getByRole('button', { name: 'preview b' }));
      }),
    ).toEqual({ c: 1, b: 1 });

    expect(
      countRendersDuring(() => {
        fireEvent.click(screen.getByRole('button', { name: 'preview e' }));
      }),
    ).toEqual({ b: 1, e: 1 });
  });

  // Req 10.2: the toggled row itself may re-render (its initial checkbox
  // state now comes from the updated selection), every other row must not.
  it('re-renders no other row when a checkbox is toggled, although the parent re-renders', () => {
    renderSearchPage();

    const rowsReRenderedByToggling = (pageId: string): string[] => {
      const counts = countRendersDuring(() => {
        fireEvent.click(
          screen.getByRole('checkbox', { name: `select ${pageId}` }),
        );
      });
      return Object.keys(counts).filter((id) => id !== pageId);
    };

    expect(rowsReRenderedByToggling('b')).toEqual([]);
    expect(screen.getByTestId('selected-count').textContent).toBe('1');

    expect(rowsReRenderedByToggling('d')).toEqual([]);
    expect(screen.getByTestId('selected-count').textContent).toBe('2');

    expect(rowsReRenderedByToggling('b')).toEqual([]);
    expect(screen.getByTestId('selected-count').textContent).toBe('1');
  });
});

// Req 8.5: the virtualized list keeps the full height of all loaded results,
// so the additional-loading sentinel must come after that container (inside
// the scroll container) to intersect only near the end of the list.
describe('SearchPageBase with the real SearchResultList: additional-loading sentinel', () => {
  it('renders the InfiniteScroll sentinel after the full-height list container, inside the scroll container', () => {
    renderSearchPage();

    const list = screen.getByTestId('search-result-list');
    const fullHeightContainer = list.parentElement;
    expect(fullHeightContainer?.style.height).toBe(`${PAGE_IDS.length * 50}px`);

    const scrollContainer = screen
      .getByTestId('search-result-base')
      .querySelector<HTMLElement>('.overflow-y-scroll');
    if (scrollContainer == null || fullHeightContainer == null) {
      throw new Error('scroll container or list container is not rendered');
    }
    // InfiniteScroll renders a relative wrapper holding an absolutely
    // positioned sentinel observed by its IntersectionObserver.
    const sentinels = Array.from(
      scrollContainer.querySelectorAll<HTMLElement>('div'),
    ).filter(
      (el) =>
        el.style.position === 'absolute' &&
        el.parentElement?.style.position === 'relative',
    );
    expect(sentinels).toHaveLength(1);

    const position = fullHeightContainer.compareDocumentPosition(sentinels[0]);
    // after the container, not nested inside it
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(position & Node.DOCUMENT_POSITION_CONTAINED_BY).toBe(0);
  });
});
