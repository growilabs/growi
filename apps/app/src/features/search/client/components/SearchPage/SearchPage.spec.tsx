import React from 'react';
import type { IPageHasId } from '@growi/core';
import { act, render } from '@testing-library/react';
import { atom } from 'jotai';
import type { SWRInfiniteResponse } from 'swr/infinite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type {
  IFormattedSearchResult,
  IPageWithSearchMeta,
} from '~/interfaces/search';

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
    hasError?: unknown;
    onRetry?: () => void;
  };
  onSelectedPagesByCheckboxesChanged?: (a: number, b: number) => void;
  searchControl?: React.ReactNode;
};

const searchPageBaseSpy = vi.hoisted(() => ({
  lastProps: undefined as CapturedSearchPageBaseProps | undefined,
  deselectAll: vi.fn(),
}));

vi.mock('./SearchPageBase', () => ({
  SearchPageBase: React.forwardRef(
    (props: CapturedSearchPageBaseProps, ref: React.Ref<unknown>) => {
      searchPageBaseSpy.lastProps = props;
      // Populate the imperative ref so SearchPage's post-delete reset can reach
      // deselectAll() (the real SearchPageBase exposes it via ISelectableAll).
      if (ref != null && typeof ref === 'object') {
        (ref as React.MutableRefObject<unknown>).current = {
          selectAll: vi.fn(),
          deselectAll: searchPageBaseSpy.deselectAll,
          getSelectedPageIds: () => new Set<string>(),
        };
      }
      // Render the searchControl slot so the bulk-delete button reached through
      // SearchControl.collapseContents is observable in the DOM (Req 5.2).
      return <>{props.searchControl}</>;
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
  DEFAULT_SEARCH_CHUNK_SIZE: 20,
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
  // Render only the collapse body (which contains the bulk-delete button) so the
  // Req 5.2 disabled/enabled contract is observable in the DOM; the rest of
  // SearchControl is exercised by its own spec.
  default: (props: { collapseContents?: React.ReactNode }) => (
    <>{props.collapseContents}</>
  ),
}));
vi.mock('./OperateAllControl', () => ({
  // Forward an imperative handle so SearchPage's selectAllControlRef is populated.
  // Without it, selectedPagesByCheckboxesChangedHandler bails out at its null-check
  // before updating selectedCount — the state that drives the delete button's
  // disabled attribute (Req 5.2).
  OperateAllControl: React.forwardRef(
    (_props: unknown, ref: React.Ref<unknown>) => {
      if (ref != null && typeof ref === 'object') {
        (ref as React.MutableRefObject<unknown>).current = {
          select: vi.fn(),
          deselect: vi.fn(),
          setIndeterminate: vi.fn(),
        };
      }
      return null;
    },
  ),
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
vi.mock('next-i18next', () => ({
  useTranslation: vi.fn(() => ({ t: (key: string) => key })),
}));

import { SearchPage } from './SearchPage';
import { usePageDeleteModalForBulkDeletion } from './SearchPageBase';

const mockedBulkDeletionHook = vi.mocked(usePageDeleteModalForBulkDeletion);

const createInfiniteResponse = (
  data: IFormattedSearchResult[] | undefined,
  error?: Error,
): SWRInfiniteResponse<IFormattedSearchResult, Error> =>
  mock<SWRInfiniteResponse<IFormattedSearchResult, Error>>({
    data,
    setSize: vi.fn(),
    mutate: vi.fn(),
    error,
  });

const createChunk = (ids: string[]): IFormattedSearchResult =>
  mock<IFormattedSearchResult>({
    data: ids.map((id) =>
      mock<IPageWithSearchMeta>({
        data: mock<IPageHasId>({ _id: id, path: `/page/${id}` }),
      }),
    ),
    meta: { total: 42, took: 3, hitsCount: ids.length },
  });

// Full chunks (hitsCount 20) against a huge total, so merged.isReachingEnd stays
// false and only the result-window guard can stop the load.
const createFullChunks = (count: number): IFormattedSearchResult[] =>
  Array.from({ length: count }, () =>
    mock<IFormattedSearchResult>({
      data: [],
      meta: { total: 1_000_000, took: 1, hitsCount: 20 },
    }),
  );

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
    // 1 loaded chunk of 2 hits out of total 42 => not at the end.
    expect(props?.infiniteScroll?.isReachingEnd).toBe(false);
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

// Req 1.6 — on additional-load failure, auto-loading halts (tight-loop
// prevention), already-loaded results are preserved, and retry revalidates.
describe('SearchPage additional-load failure handling (Req 1.6)', () => {
  beforeEach(() => {
    searchPageBaseSpy.lastProps = undefined;
    keywordSpy.keyword = 'initial-keyword';
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('halts auto-load on error (isReachingEnd forced true) while preserving loaded pages', () => {
    // A non-terminal result (2 of 42 loaded) that additionally errored: without
    // the halt, InfiniteScroll would keep calling setSize and tight-loop.
    searchStoreSpy.infiniteResponse = createInfiniteResponse(
      [createChunk(['a', 'b'])],
      new Error('load failed'),
    );

    render(<SearchPage />);

    const infiniteScroll = searchPageBaseSpy.lastProps?.infiniteScroll;
    expect(infiniteScroll?.hasError).toBe(true);
    // isReachingEnd must be forced true so InfiniteScroll stops auto-loading,
    // even though only 2 of 42 results are loaded (merged.isReachingEnd=false).
    expect(infiniteScroll?.isReachingEnd).toBe(true);

    // Already-loaded results are still handed down (not discarded on error).
    expect(searchPageBaseSpy.lastProps?.pages).toHaveLength(2);
  });

  it('revalidates via swr.mutate when onRetry is invoked', () => {
    searchStoreSpy.infiniteResponse = createInfiniteResponse(
      [createChunk(['a', 'b'])],
      new Error('load failed'),
    );

    render(<SearchPage />);

    const infiniteScroll = searchPageBaseSpy.lastProps?.infiniteScroll;
    infiniteScroll?.onRetry?.();

    expect(searchStoreSpy.infiniteResponse?.mutate).toHaveBeenCalledTimes(1);
  });

  it('allows auto-load when there is no error and the end is not reached', () => {
    // No error, 2 of 42 loaded → auto-load must remain enabled.
    searchStoreSpy.infiniteResponse = createInfiniteResponse([
      createChunk(['a', 'b']),
    ]);

    render(<SearchPage />);

    const infiniteScroll = searchPageBaseSpy.lastProps?.infiniteScroll;
    expect(infiniteScroll?.hasError).toBe(false);
    expect(infiniteScroll?.isReachingEnd).toBe(false);
  });

  it('stops at the Elasticsearch max_result_window even when the total is not reached (P2-4)', () => {
    // limit is 20 (showPageLimitationL unset). With 500 loaded chunks the next
    // offset is 500 * 20 = 10000, and 10000 + 20 > 10000 exceeds the window,
    // even though only 10000 of 1,000,000 results are fetched.
    searchStoreSpy.infiniteResponse = createInfiniteResponse(
      createFullChunks(500),
    );

    render(<SearchPage />);

    const infiniteScroll = searchPageBaseSpy.lastProps?.infiniteScroll;
    expect(infiniteScroll?.hasError).toBe(false);
    expect(infiniteScroll?.isReachingEnd).toBe(true);
  });

  it('keeps auto-load enabled just below the max_result_window (P2-4 boundary)', () => {
    // 499 chunks => next offset 499 * 20 = 9980, and 9980 + 20 = 10000 is NOT
    // greater than the window, so loading may continue.
    searchStoreSpy.infiniteResponse = createInfiniteResponse(
      createFullChunks(499),
    );

    render(<SearchPage />);

    const infiniteScroll = searchPageBaseSpy.lastProps?.infiniteScroll;
    expect(infiniteScroll?.isReachingEnd).toBe(false);
  });
});

// Req 5.1/5.3/7.2 — bulk-delete orchestration: only selected loaded pages are
// handed to the modal, and completing a delete resets the accumulation to the
// first chunk while clearing the selection.
describe('SearchPage bulk-delete orchestration (Req 5.1/5.3/7.2)', () => {
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

  // The onDeleted callback that SearchPage wires into the bulk-deletion hook.
  const getOnDeleted = () =>
    mockedBulkDeletionHook.mock.calls.at(-1)?.[2] as
      | ((...args: unknown[]) => void)
      | undefined;

  it('hands the accumulated pages array to the bulk-deletion hook (Req 5.1)', () => {
    searchStoreSpy.infiniteResponse = createInfiniteResponse([
      createChunk(['a', 'b']),
      createChunk(['c', 'd']),
    ]);

    render(<SearchPage />);

    // The first arg is the merged/accumulated pages across appends (4 pages).
    expect(mockedBulkDeletionHook.mock.calls.at(-1)?.[0]).toHaveLength(4);
  });

  it('re-fetches from the first chunk on delete completion: setSize(1) then mutate (Req 5.3)', () => {
    render(<SearchPage />);

    const swr = searchStoreSpy.infiniteResponse;
    // Nothing resets the accumulation on a plain render.
    expect(swr?.setSize).not.toHaveBeenCalled();

    act(() => {
      getOnDeleted()?.();
    });

    expect(swr?.setSize).toHaveBeenCalledWith(1);
    expect(swr?.mutate).toHaveBeenCalledTimes(1);
  });

  it('clears the selection on delete completion via deselectAll (Req 7.2)', () => {
    render(<SearchPage />);

    expect(searchPageBaseSpy.deselectAll).not.toHaveBeenCalled();

    act(() => {
      getOnDeleted()?.();
    });

    expect(searchPageBaseSpy.deselectAll).toHaveBeenCalledTimes(1);
  });
});

// Req 5.2 — the bulk-delete execution button must be disabled while the selection
// is empty and become enabled once at least one loaded page is selected.
describe('SearchPage bulk-delete disabling (Req 5.2)', () => {
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

  const getDeleteButton = (container: HTMLElement) =>
    container.querySelector<HTMLButtonElement>(
      'button.open-delete-modal-button',
    );

  it('disables the bulk-delete button while nothing is selected (Req 5.2)', () => {
    const { container } = render(<SearchPage />);

    // selectedCount starts at 0 → the execute-delete button must be disabled.
    expect(getDeleteButton(container)).toBeDisabled();
  });

  it('enables the bulk-delete button once at least one page is selected (Req 5.2)', () => {
    const { container } = render(<SearchPage />);
    expect(getDeleteButton(container)).toBeDisabled();

    // Simulate an individual-checkbox selection reported up from SearchPageBase
    // (2 of 4 loaded rows selected) — selectedCount becomes non-zero.
    act(() => {
      searchPageBaseSpy.lastProps?.onSelectedPagesByCheckboxesChanged?.(2, 4);
    });

    expect(getDeleteButton(container)).toBeEnabled();
  });
});
