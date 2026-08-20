import type React from 'react';
import type { ForwardRefRenderFunction, JSX } from 'react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import dynamic from 'next/dynamic';
import { LoadingSpinner } from '@growi/ui/dist/components';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'next-i18next';
import type { SWRInfiniteResponse } from 'swr/infinite';

import type { ForceHideMenuItems } from '~/client/components/Common/Dropdown/PageItemControl';
import InfiniteScroll from '~/client/components/InfiniteScroll';
import type { ISelectableAll } from '~/client/interfaces/selectable-all';
import { toastSuccess } from '~/client/util/toastr';
import type {
  IFormattedSearchResult,
  IPageWithSearchMeta,
} from '~/interfaces/search';
import type { OnDeletedFunction } from '~/interfaces/ui';
import { useIsGuestUser, useIsReadOnlyUser } from '~/states/context';
import { useKeywordManager } from '~/states/search';
import {
  isSearchServiceConfiguredAtom,
  isSearchServiceReachableAtom,
} from '~/states/server-configurations';
import { usePageDeleteModalActions } from '~/states/ui/modal/page-delete';
import { mutatePageTree, mutateRecentlyUpdated } from '~/stores/page-listing';

// Do not import with next/dynamic
// see: https://github.com/growilabs/growi/pull/7923
import { SearchResultList } from './SearchResultList';

import styles from './SearchPageBase.module.scss';

// https://regex101.com/r/brrkBu/1
const highlightKeywordsSplitter = /"[^"]+"|[^\u{20}\u{3000}]+/gu;

export interface IReturnSelectedPageIds {
  getSelectedPageIds?: () => Set<string>;
}

// Imperative reset for a same-search mutation (e.g. bulk delete / convert) that
// does NOT change `resetKey`. Bundles exactly what a `resetKey` change would do
// (clear preview, clear checkbox selection, notify the parent) so a caller does
// not have to reconstruct that sequence itself (R-2 / A-7).
export interface IResettableAfterMutation {
  resetAfterMutation: () => void;
}

// Optional wiring for infinite-scroll rendering. When present, the result list
// is wrapped in <InfiniteScroll> instead of the legacy numbered pager.
type SearchPageBaseInfiniteProps = {
  swrInfiniteResponse: SWRInfiniteResponse<IFormattedSearchResult, Error>;
  // Computed by the caller: accumulated count >= total, or a fetch error.
  isReachingEnd: boolean;
  hasError: boolean;
  onRetry: () => void;
};

type Props = {
  className?: string;
  pages?: IPageWithSearchMeta[];
  searchingKeyword?: string;

  // Identity of the current search. Selection is reset only when this value
  // changes (new search / condition change), never on every `pages` update.
  // Appended pages under a stable `resetKey` keep the existing selection.
  resetKey: string;

  forceHideMenuItems?: ForceHideMenuItems;

  onSelectedPagesByCheckboxesChanged?: (
    selectedCount: number,
    totalCount: number,
  ) => void;

  searchControl: React.ReactNode;
  searchResultListHead: JSX.Element;
  // Legacy numbered pager. Omit when `infiniteScroll` is provided.
  searchPager?: React.ReactNode;

  // When provided, the result list is rendered inside <InfiniteScroll> and the
  // numbered pager is suppressed. When omitted, legacy pager rendering is kept.
  infiniteScroll?: SearchPageBaseInfiniteProps;

  // Called after a single-row page operation (duplicate / rename / delete) so
  // the caller can revalidate ITS OWN active SWR response. The global
  // `mutateSearching()` cannot reach an active `useSWRInfinite` subscription
  // (SWR's filtered `mutate` explicitly skips `$inf$`-prefixed keys), so the
  // infinite-scroll caller must pass its own bound `mutate` here (A-1).
  onItemMutated?: () => void;
};

const SearchResultContent = dynamic(
  () => import('./SearchResultContent').then((mod) => mod.SearchResultContent),
  {
    ssr: false,
    loading: () => <></>,
  },
);
const SearchPageBaseSubstance: ForwardRefRenderFunction<
  ISelectableAll & IReturnSelectedPageIds & IResettableAfterMutation,
  Props
> = (props: Props, ref) => {
  const {
    className,
    pages,
    searchingKeyword,
    resetKey,
    forceHideMenuItems,
    onSelectedPagesByCheckboxesChanged,
    searchControl,
    searchResultListHead,
    searchPager,
    infiniteScroll,
    onItemMutated,
  } = props;

  const { t } = useTranslation();

  const searchResultListRef = useRef<ISelectableAll | null>(null);

  // Initialize keyword manager for URL synchronization
  useKeywordManager();

  const isGuestUser = useIsGuestUser();
  const isReadOnlyUser = useIsReadOnlyUser();
  const isSearchServiceConfigured = useAtomValue(isSearchServiceConfiguredAtom);
  const isSearchServiceReachable = useAtomValue(isSearchServiceReachableAtom);

  const [selectedPageIdsByCheckboxes] = useState<Set<string>>(new Set());
  // const [allPageIds] = useState<Set<string>>(new Set());

  const [selectedPageWithMeta, setSelectedPageWithMeta] = useState<
    IPageWithSearchMeta | undefined
  >();

  // Keep the latest change handler in a ref so the effects below can call it
  // without listing it in their deps. Otherwise a consumer passing an inline
  // handler would re-run (and clear) the selection on every render (P3-1).
  const onSelectedChangedRef = useRef(onSelectedPagesByCheckboxesChanged);
  onSelectedChangedRef.current = onSelectedPagesByCheckboxesChanged;

  // Tracks the `resetKey` whose initial preview (first item) has already been
  // applied, so an append under the same `resetKey` does not re-select pages[0]
  // and overwrite the user's chosen preview (Req 6.3).
  const appliedPreviewResetKeyRef = useRef<string | undefined>(undefined);

  // publish selectAll()
  useImperativeHandle(ref, () => ({
    selectAll: () => {
      const instance = searchResultListRef.current;
      if (instance != null) {
        instance.selectAll();
      }

      if (pages != null) {
        pages.forEach((page) => {
          selectedPageIdsByCheckboxes.add(page.data._id);
        });
      }
    },
    deselectAll: () => {
      const instance = searchResultListRef.current;
      if (instance != null) {
        instance.deselectAll();
      }

      selectedPageIdsByCheckboxes.clear();
    },
    getSelectedPageIds: () => {
      return selectedPageIdsByCheckboxes;
    },
    // Same-search mutation reset (e.g. bulk delete / convert completion). Unlike
    // a `resetKey` change, the search identity does not change here, so this
    // must be triggered imperatively rather than by an effect (A-3 / A-7).
    resetAfterMutation: () => {
      // Clear the preview and forget the applied-preview marker so the NEXT
      // `pages` arrival under the SAME resetKey (the post-mutation refetch) is
      // treated as a fresh first arrival and re-selects pages[0] (A-3) —
      // otherwise the deleted page stays pinned in the right pane forever.
      setSelectedPageWithMeta(undefined);
      appliedPreviewResetKeyRef.current = undefined;

      selectedPageIdsByCheckboxes.clear();
      searchResultListRef.current?.deselectAll();
      onSelectedChangedRef.current?.(0, 0);
    },
  }));

  const checkboxChangedHandler = (isChecked: boolean, pageId: string) => {
    if (pages == null || pages.length === 0) {
      return;
    }

    if (isChecked) {
      selectedPageIdsByCheckboxes.add(pageId);
    } else {
      selectedPageIdsByCheckboxes.delete(pageId);
    }

    if (onSelectedPagesByCheckboxesChanged != null) {
      onSelectedPagesByCheckboxesChanged(
        selectedPageIdsByCheckboxes.size,
        pages.length,
      );
    }
  };

  // The last `pages` reference effect (b) below has actually processed. Used to
  // detect a `keepPreviousData` (legacy number-pager) holdover: when `resetKey`
  // changes but `pages` is the EXACT SAME reference as before, the real refetch
  // for the new resetKey has not landed yet — it is still serving the previous
  // search's data (A-2). A freshly mounted/rendered `pages` array (first arrival
  // for this resetKey) is a NEW reference and must not be mistaken for this.
  const lastProcessedPagesRef = useRef<IPageWithSearchMeta[] | undefined>(
    undefined,
  );

  // Right-pane preview initial selection — 2-stage, resetKey-driven.
  // (a) When `resetKey` changes, clear the preview immediately. At that moment
  //     the new `pages` may not have arrived yet, so there is nothing to select.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey is the sole trigger — clear the preview only when the search identity changes, not on every pages update
  useEffect(() => {
    setSelectedPageWithMeta(undefined);
  }, [resetKey]);

  // (b) On the FIRST *new* pages arrival for the current `resetKey`, select the
  //     first item exactly once. Subsequent appends (same `resetKey`) are
  //     ignored so the user's chosen preview is preserved (Req 6.1 / 6.3).
  useEffect(() => {
    const isStaleCarryover = pages === lastProcessedPagesRef.current;
    lastProcessedPagesRef.current = pages;

    // No data yet (e.g. right after a resetKey change): keep preview cleared.
    if (pages == null || pages.length === 0) {
      setSelectedPageWithMeta(undefined);
      return;
    }
    // Initial preview already applied for this search => this is an append.
    if (appliedPreviewResetKeyRef.current === resetKey) {
      return;
    }
    // Same reference already processed (keepPreviousData holding over the
    // PREVIOUS search's pages across the resetKey transition) — wait for the
    // real refetch for the new resetKey instead of re-selecting stale data (A-2).
    if (isStaleCarryover) {
      return;
    }
    appliedPreviewResetKeyRef.current = resetKey;
    setSelectedPageWithMeta(pages[0]);
  }, [pages, resetKey]);

  // Reset selection when the search identity (`resetKey`) changes.
  // This is data-independent: empty the Set and notify a count of 0.
  // Appending pages (resetKey unchanged) does NOT fire this effect, so the
  // selection is preserved (Req 4.3); only a new search / condition change
  // (resetKey change) clears it (Req 7.2).
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey is a trigger dep — re-run this effect only when the search identity changes, not when the reset body itself changes
  useEffect(() => {
    selectedPageIdsByCheckboxes.clear();

    // Also uncheck the currently rendered rows. With keepPreviousData (the
    // legacy number-pager path), the previous page's rows stay mounted for a
    // moment after a resetKey change, so clearing only the Set would leave
    // stale checkmarks visible (P3-7).
    searchResultListRef.current?.deselectAll();

    onSelectedChangedRef.current?.(0, 0);
  }, [resetKey, selectedPageIdsByCheckboxes]);

  // Keep the select-all header (checked / indeterminate) in sync with appends.
  // On append, no checkbox event fires, so the parent's checked/indeterminate
  // state would go stale. When `pages` grows under a STABLE `resetKey`, re-report
  // the CURRENT selected count against the CURRENT accumulated total so the parent
  // recomputes checked (all selected) vs indeterminate (partial) (Req 4.4/4.5/4.6).
  // A `resetKey` change is skipped here so this does not double-fire against the
  // selection-clear effect above, which already notifies (0, 0) in that case.
  const notifiedAppendResetKeyRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const isSameSearch = notifiedAppendResetKeyRef.current === resetKey;
    notifiedAppendResetKeyRef.current = resetKey;

    // First render or a new search: the selection-clear effect owns the
    // notification. Do not re-notify here.
    if (!isSameSearch || pages == null) {
      return;
    }

    onSelectedChangedRef.current?.(
      selectedPageIdsByCheckboxes.size,
      pages.length,
    );
  }, [pages, resetKey, selectedPageIdsByCheckboxes]);

  if (!isSearchServiceConfigured) {
    return (
      <div className="container-lg grw-container-convertible">
        <div className="row mt-5">
          <div className="col text-muted">
            <h1>Search service is not configured in this system.</h1>
          </div>
        </div>
      </div>
    );
  }

  if (!isSearchServiceReachable) {
    return (
      <div className="container-lg grw-container-convertible">
        <div className="row mt-5">
          <div className="col text-muted">
            <h1>
              Search service occures errors. Please contact to administrators of
              this system.
            </h1>
          </div>
        </div>
      </div>
    );
  }

  const highlightKeywords =
    searchingKeyword != null
      ? // Remove double quotation marks before and after a keyword if present
        // https://regex101.com/r/4QKBwg/1
        (searchingKeyword
          .match(highlightKeywordsSplitter)
          ?.map((keyword) => keyword.replace(/^"(.*)"$/, '$1')) ?? undefined)
      : undefined;

  // Selection wiring on SearchResultList is IDENTICAL across the infinite-scroll
  // and legacy branches; only the wrapping (InfiniteScroll vs. numbered pager)
  // differs (P3-5: computed here instead of an IIFE inside the JSX below).
  const searchResultListNode = pages != null && pages.length > 0 && (
    <div className={`page-list ${styles['page-list']} px-md-4`}>
      <SearchResultList
        ref={searchResultListRef}
        pages={pages}
        selectedPageId={selectedPageWithMeta?.data._id}
        forceHideMenuItems={forceHideMenuItems}
        onPageSelected={(page) => setSelectedPageWithMeta(page)}
        onCheckboxChanged={checkboxChangedHandler}
        onItemMutated={onItemMutated}
      />
    </div>
  );

  const pagedResultNode =
    infiniteScroll != null ? (
      <InfiniteScroll
        swrInifiniteResponse={infiniteScroll.swrInfiniteResponse}
        isReachingEnd={infiniteScroll.isReachingEnd}
        endingIndicator={
          infiniteScroll.hasError ? (
            <div className="my-4 d-flex flex-column align-items-center">
              <span className="text-muted">
                {t('search_result.failed_to_load_more')}
              </span>
              <button
                type="button"
                className="btn btn-outline-secondary mt-2"
                onClick={infiniteScroll.onRetry}
              >
                {t('Retry')}
              </button>
            </div>
          ) : undefined
        }
      >
        {searchResultListNode}
      </InfiniteScroll>
    ) : (
      <>
        {searchResultListNode}
        <div className="my-4 d-flex justify-content-center">{searchPager}</div>
      </>
    );

  return (
    <div
      className={`${className ?? ''} search-result-base flex-grow-1 d-flex flex-expand-vh-100`}
      data-testid="search-result-base"
    >
      <div
        className="flex-expand-vert border boder-gray search-result-list"
        id="search-result-list"
      >
        {searchControl}

        <div className="overflow-y-scroll">
          {/* Loading */}
          {pages == null && (
            <div className="mw-0 flex-grow-1 flex-basis-0 m-5 text-muted text-center">
              <LoadingSpinner className="me-1 fs-3" />
            </div>
          )}

          {/* Loaded */}
          {pages != null && (
            <>
              <div className="my-3 px-md-4 px-3">{searchResultListHead}</div>

              {pagedResultNode}
            </>
          )}
        </div>
      </div>

      <div
        className={`${styles['search-result-content']} flex-expand-vert d-none d-lg-flex`}
      >
        {pages != null &&
          pages.length !== 0 &&
          selectedPageWithMeta != null && (
            <SearchResultContent
              pageWithMeta={selectedPageWithMeta}
              highlightKeywords={highlightKeywords}
              showPageControlDropdown={!(isGuestUser || isReadOnlyUser)}
              forceHideMenuItems={forceHideMenuItems}
            />
          )}
      </div>
    </div>
  );
};

type VoidFunction = () => void;

export const usePageDeleteModalForBulkDeletion = (
  // Accepts the accumulated page list (across infinite-scroll appends), not a
  // single-page result, so bulk deletion targets every loaded page.
  pages: IPageWithSearchMeta[] | undefined,
  ref: React.MutableRefObject<(ISelectableAll & IReturnSelectedPageIds) | null>,
  onDeleted?: OnDeletedFunction,
): VoidFunction => {
  const { t } = useTranslation();

  const { open: openDeleteModal } = usePageDeleteModalActions();

  // Stable identity: an inline arrow returned from this hook was recreated on
  // every render, invalidating any caller `useMemo` that lists it as a dep
  // (e.g. SearchPage's `collapseContents` / `searchControl`), which defeated
  // the re-render suppression P3-4 was meant to add (A-5).
  return useCallback(() => {
    if (pages == null) {
      return;
    }

    const instance = ref.current;
    if (instance == null || instance.getSelectedPageIds == null) {
      return;
    }

    const selectedPageIds = instance.getSelectedPageIds();

    if (selectedPageIds.size === 0) {
      return;
    }

    const selectedPages = pages.filter((pageWithMeta) =>
      selectedPageIds.has(pageWithMeta.data._id),
    );

    openDeleteModal(selectedPages, {
      onDeleted: (...args) => {
        const path = args[0];
        const isCompletely = args[2];
        if (path == null || isCompletely == null) {
          toastSuccess(t('deleted_page'));
        } else {
          toastSuccess(t('deleted_pages_completely', { path }));
        }
        mutatePageTree();
        mutateRecentlyUpdated();

        if (onDeleted != null) {
          onDeleted(...args);
        }
      },
    });
  }, [pages, ref, onDeleted, openDeleteModal, t]);
};

export const SearchPageBase = forwardRef(SearchPageBaseSubstance);
