import React from 'react';
import { render } from '@testing-library/react';
import { atom } from 'jotai';
import type { SWRInfiniteResponse } from 'swr/infinite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type { IFormattedSearchResult } from '~/interfaces/search';

// --- Capture the props SearchPage hands to SearchPageBase ---------------------
// SearchPageBase itself is exercised by its own spec; here it is a passthrough
// stub that records the props so SearchPage's wiring can be asserted.
type CapturedSearchPageBaseProps = {
  pages?: unknown;
  resetKey?: unknown;
  searchPager?: unknown;
  infiniteScroll?: {
    swrInfiniteResponse?: unknown;
    isReachingEnd?: unknown;
  };
  onSelectedPagesByCheckboxesChanged?: (a: number, b: number) => void;
};

const searchPageBaseSpy = vi.hoisted(() => ({
  lastProps: undefined as CapturedSearchPageBaseProps | undefined,
}));

vi.mock('./SearchPageBase', () => ({
  SearchPageBase: React.forwardRef(
    (props: CapturedSearchPageBaseProps, _ref: React.Ref<unknown>) => {
      searchPageBaseSpy.lastProps = props;
      return null;
    },
  ),
  usePageDeleteModalForBulkDeletion: vi.fn(() => vi.fn()),
}));

// --- Controlled search-store hooks -------------------------------------------
const searchStoreSpy = vi.hoisted(() => ({
  infiniteResponse: undefined as
    | SWRInfiniteResponse<IFormattedSearchResult, Error>
    | undefined,
}));

vi.mock('~/stores/search', () => ({
  useSWRINFxSearch: vi.fn(() => searchStoreSpy.infiniteResponse),
  // Kept so the pre-refactor implementation still resolves its import during
  // the RED phase; the post-refactor implementation no longer imports it.
  useSWRxSearch: vi.fn(() => ({
    data: { data: [], meta: { total: 0, took: 1, hitsCount: 0 } },
    conditions: { offset: 0, limit: 20 },
    mutate: vi.fn(),
  })),
}));

// --- Search keyword state -----------------------------------------------------
const keywordSpy = vi.hoisted(() => ({ keyword: 'initial-keyword' }));
vi.mock('~/states/search', () => ({
  useSearchKeyword: vi.fn(() => keywordSpy.keyword),
  useSetSearchKeyword: vi.fn(() => vi.fn()),
}));

// --- Server-configuration atoms (read via jotai useAtomValue) ----------------
vi.mock('~/states/server-configurations', () => ({
  disableUserPagesAtom: atom(false),
  showPageLimitationLAtom: atom<number | undefined>(undefined),
}));

// --- Peripheral UI dependencies (never actually rendered here) ---------------
vi.mock('./SearchControl', () => ({
  default: () => null,
}));
vi.mock('./OperateAllControl', () => ({
  OperateAllControl: () => null,
}));
vi.mock('~/client/components/NotAvailableForGuest', () => ({
  NotAvailableForGuest: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock('~/client/components/NotAvailableForReadOnlyUser', () => ({
  NotAvailableForReadOnlyUser: ({
    children,
  }: {
    children?: React.ReactNode;
  }) => <>{children}</>,
}));
vi.mock('~/client/components/PaginationWrapper', () => ({
  default: () => <div data-testid="pagination-wrapper" />,
}));
vi.mock('next-i18next', () => ({
  useTranslation: vi.fn(() => ({ t: (key: string) => key })),
}));

import { SearchPage } from './SearchPage';

const createInfiniteResponse = (
  data: IFormattedSearchResult[] | undefined,
): SWRInfiniteResponse<IFormattedSearchResult, Error> =>
  mock<SWRInfiniteResponse<IFormattedSearchResult, Error>>({
    data,
    setSize: vi.fn(),
    mutate: vi.fn(),
    error: undefined,
  });

const createChunk = (ids: string[]): IFormattedSearchResult =>
  ({
    data: ids.map((id) => ({ data: { _id: id, path: `/page/${id}` } })),
    meta: { total: 42, took: 3, hitsCount: ids.length },
  }) as unknown as IFormattedSearchResult;

describe('SearchPage infinite-scroll wiring', () => {
  beforeEach(() => {
    searchPageBaseSpy.lastProps = undefined;
    keywordSpy.keyword = 'initial-keyword';
    searchStoreSpy.infiniteResponse = createInfiniteResponse([
      createChunk(['a', 'b']),
    ]);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not hand a numbered pager element to SearchPageBase (searchPager is null)', () => {
    render(<SearchPage />);

    // The legacy PaginationWrapper element is gone; infinite scroll drives paging.
    expect(searchPageBaseSpy.lastProps?.searchPager).toBeFalsy();
  });

  it('passes an infiniteScroll prop carrying the SWRInfinite response and a boolean isReachingEnd, plus a string resetKey', () => {
    render(<SearchPage />);

    const props = searchPageBaseSpy.lastProps;
    expect(props?.infiniteScroll).toBeDefined();
    expect(props?.infiniteScroll?.swrInfiniteResponse).toBe(
      searchStoreSpy.infiniteResponse,
    );
    expect(typeof props?.infiniteScroll?.isReachingEnd).toBe('boolean');
    expect(typeof props?.resetKey).toBe('string');
  });

  it('keeps resetKey stable when only the loaded size grows, but changes it when the keyword changes', () => {
    const { rerender } = render(<SearchPage />);
    const resetKeyInitial = searchPageBaseSpy.lastProps?.resetKey;
    expect(typeof resetKeyInitial).toBe('string');

    // Simulate an infinite-scroll append: more chunks loaded, same search identity.
    searchStoreSpy.infiniteResponse = createInfiniteResponse([
      createChunk(['a', 'b']),
      createChunk(['c', 'd']),
    ]);
    rerender(<SearchPage />);
    const resetKeyAfterAppend = searchPageBaseSpy.lastProps?.resetKey;
    expect(resetKeyAfterAppend).toBe(resetKeyInitial);

    // A new keyword is a new search identity => resetKey must change.
    keywordSpy.keyword = 'different-keyword';
    rerender(<SearchPage />);
    const resetKeyAfterKeywordChange = searchPageBaseSpy.lastProps?.resetKey;
    expect(resetKeyAfterKeywordChange).not.toBe(resetKeyInitial);
  });
});
