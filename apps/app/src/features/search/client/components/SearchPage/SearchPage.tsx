import React, { type JSX, useCallback, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'next-i18next';

import { NotAvailableForGuest } from '~/client/components/NotAvailableForGuest';
import { NotAvailableForReadOnlyUser } from '~/client/components/NotAvailableForReadOnlyUser';
import type {
  ISelectableAll,
  ISelectableAndIndeterminatable,
} from '~/client/interfaces/selectable-all';
import { SORT_AXIS, SORT_ORDER } from '~/interfaces/search';
import { useSearchKeyword, useSetSearchKeyword } from '~/states/search';
import {
  disableUserPagesAtom,
  showPageLimitationLAtom,
} from '~/states/server-configurations';
import {
  DEFAULT_SEARCH_CHUNK_SIZE,
  type ISearchConditions,
  type ISearchConfigurations,
  useSWRINFxSearch,
} from '~/stores/search';

import { mergeInfiniteSearchResult } from '../../util/infinite-search-result';
import { OperateAllControl } from './OperateAllControl';
import SearchControl from './SearchControl';
import type { IReturnSelectedPageIds } from './SearchPageBase';
import {
  SearchPageBase,
  usePageDeleteModalForBulkDeletion,
} from './SearchPageBase';

import styles from './SearchPage.module.scss';

// Elasticsearch `index.max_result_window` default. A query is rejected once
// `limit + offset` exceeds it, so infinite scroll must stop before that point.
const ES_MAX_RESULT_WINDOW = 10000;

/**
 * SearchResultListHead
 */

type SearchResultListHeadProps = {
  total: number;
  took?: number;
};

const SearchResultListHead = React.memo(
  (props: SearchResultListHeadProps): JSX.Element => {
    const { t } = useTranslation();

    const { total, took } = props;

    if (total === 0) {
      return (
        <div className="d-flex justify-content-center h2 text-muted my-5">
          0 {t('search_result.page_number_unit')}
        </div>
      );
    }

    return (
      <div className="d-flex align-items-center justify-content-between">
        <div className="text-nowrap">
          <span className="ms-3 fw-bold">
            {total} {t('search_result.hit_number_unit', 'hit')}
          </span>
          {took != null && (
            // blackout 70px rectangle in VRT
            <span
              data-vrt-blackout
              className="ms-3 text-muted d-inline-block"
              style={{ minWidth: '70px' }}
            >
              ({took}ms)
            </span>
          )}
        </div>
        {/* NOTE: The paging-size selector is intentionally removed for infinite
            scroll (Req 3.2). Do NOT restore it. */}
      </div>
    );
  },
);

SearchResultListHead.displayName = 'SearchResultListHead';

export const SearchPage = (): JSX.Element => {
  const { t } = useTranslation();
  const showPageLimitationL = useAtomValue(showPageLimitationLAtom);

  const keyword = useSearchKeyword();
  const setSearchKeyword = useSetSearchKeyword();

  const disableUserPages = useAtomValue(disableUserPagesAtom);

  // Fixed chunk size for the whole search session (no user-facing selector).
  // Floor to the default when misconfigured (<= 0, which `??` does not catch) so
  // the fetch, the merge, and the result-window guard all use the same value.
  const chunkSize =
    showPageLimitationL != null && showPageLimitationL > 0
      ? showPageLimitationL
      : DEFAULT_SEARCH_CHUNK_SIZE;

  const [configurationsByControl, setConfigurationsByControl] = useState<
    Partial<ISearchConfigurations>
  >({});
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [selectedCount, setSelectedCount] = useState(0);

  const selectAllControlRef = useRef<ISelectableAndIndeterminatable | null>(
    null,
  );
  const searchPageBaseRef = useRef<
    (ISelectableAll & IReturnSelectedPageIds) | null
  >(null);

  const swr = useSWRINFxSearch(keyword ?? '', null, {
    ...configurationsByControl,
    limit: chunkSize,
  });
  // useSWRInfinite returns a fresh object every render; destructure its stable
  // members so the callbacks below keep stable identities (and their memoized
  // consumers, e.g. searchControl, are not recomputed on every append).
  const { data: swrData, error: swrError, setSize, mutate } = swr;

  // Accumulated, render-ready result derived from the infinite-scroll chunks.
  const merged = useMemo(
    () => mergeInfiniteSearchResult(swrData, chunkSize),
    [swrData, chunkSize],
  );

  const hasError = swrError != null;

  // Elasticsearch rejects a query whose `limit + offset` exceeds
  // `max_result_window` (default 10000). The next chunk's offset is
  // `loadedChunks * limit`, so stop before requesting one that would exceed the
  // window — otherwise scrolling to the cap fails on every further attempt.
  const loadedChunks = swrData?.length ?? 0;
  const reachedResultWindowLimit =
    (loadedChunks + 1) * chunkSize > ES_MAX_RESULT_WINDOW;

  const onRetry = useCallback(() => {
    mutate();
  }, [mutate]);

  // Identity of the current search. Derived WITHOUT offset/size/pageIndex so it
  // stays stable across infinite-scroll appends and changes only on a new
  // search / sort / filter change (Req 7.1).
  const resetKey = useMemo(() => {
    const { sort, order, includeTrashPages, includeUserPages } =
      configurationsByControl;
    return JSON.stringify({
      keyword: keyword ?? '',
      sort: sort ?? SORT_AXIS.RELATION_SCORE,
      order: order ?? SORT_ORDER.DESC,
      includeTrashPages: includeTrashPages ?? false,
      includeUserPages: includeUserPages ?? false,
    });
  }, [keyword, configurationsByControl]);

  const searchInvokedHandler = useCallback(
    (newKeyword: string, newConfigurations: Partial<ISearchConfigurations>) => {
      setConfigurationsByControl(newConfigurations);
      setSearchKeyword(newKeyword);

      // Discard the accumulation and reload from the first chunk (Req 7.1).
      // `mutate()` forces a refetch even when the SWR key is unchanged, so
      // re-running the identical keyword/conditions still refreshes results.
      setSize(1);
      mutate();
    },
    [setSearchKeyword, setSize, mutate],
  );

  const selectAllCheckboxChangedHandler = useCallback((isChecked: boolean) => {
    const instance = searchPageBaseRef.current;

    if (instance == null) {
      return;
    }

    if (isChecked) {
      instance.selectAll();
    } else {
      instance.deselectAll();
    }

    // update selected count
    setSelectedCount(instance.getSelectedPageIds?.().size ?? 0);
  }, []);

  const selectedPagesByCheckboxesChangedHandler = useCallback(
    (selectedCount: number, totalCount: number) => {
      const instance = selectAllControlRef.current;

      if (instance == null) {
        return;
      }

      if (selectedCount === 0) {
        instance.deselect();
      } else if (selectedCount === totalCount) {
        instance.select();
      } else {
        setIsCollapsed(true);
        instance.setIndeterminate();
      }

      // update selected count
      setSelectedCount(selectedCount);
    },
    [],
  );

  const initialSearchConditions: Partial<ISearchConditions> = useMemo(() => {
    return {
      keyword,
      limit: DEFAULT_SEARCH_CHUNK_SIZE,
    };
  }, [keyword]);

  // Post-delete reset (Req 5.3 / 7.2): discard the accumulation and reload from
  // the first chunk, then clear the selection. Order matters — reset the size to
  // 1 BEFORE revalidating so the first-chunk re-fetch is not raced by a mutate()
  // against the stale (larger) size; the selection is cleared last so it never
  // reflects rows that the reload has already dropped.
  const deleteCompletedHandler = useCallback(() => {
    setSize(1);
    mutate();
    searchPageBaseRef.current?.deselectAll();
    setSelectedCount(0);
  }, [setSize, mutate]);

  // for bulk deletion — target every accumulated page across appends. Selection
  // of only the loaded-and-selected pages is handled inside the hook (Req 5.1).
  const deleteAllButtonClickedHandler = usePageDeleteModalForBulkDeletion(
    merged.pages,
    searchPageBaseRef,
    deleteCompletedHandler,
  );

  const extraControls = useMemo(() => {
    return (
      <NotAvailableForGuest>
        <NotAvailableForReadOnlyUser>
          <button
            type="button"
            className={`${isCollapsed ? 'active' : ''} btn btn-muted-danger d-flex align-items-center ms-2`}
            aria-expanded="false"
            onClick={() => {
              setIsCollapsed(!isCollapsed);
            }}
          >
            <span className="material-symbols-outlined fs-5">delete</span>
            <span
              className={`material-symbols-outlined me-1 ${isCollapsed ? 'rotate-180' : ''}`}
            >
              keyboard_arrow_down
            </span>
          </button>
        </NotAvailableForReadOnlyUser>
      </NotAvailableForGuest>
    );
  }, [isCollapsed]);

  const collapseContents = useMemo(() => {
    return (
      <NotAvailableForGuest>
        <NotAvailableForReadOnlyUser>
          <div className="d-flex align-items-center py-2">
            <div className="ms-4">
              <OperateAllControl
                inputId="cb-select-all"
                inputClassName="form-check-input"
                ref={selectAllControlRef}
                isCheckboxDisabled={merged.isEmpty}
                onCheckboxChanged={selectAllCheckboxChangedHandler}
              >
                <label
                  className="form-check-label ms-2"
                  htmlFor="cb-select-all"
                >
                  {t('search_result.select_all')}
                </label>
              </OperateAllControl>
            </div>

            <button
              type="button"
              className="ms-3 open-delete-modal-button btn btn-outline-danger d-flex align-items-center"
              disabled={selectedCount === 0}
              onClick={deleteAllButtonClickedHandler}
            >
              <span className="material-symbols-outlined fs-5">delete</span>
              {t('search_result.delete_selected_pages')}
            </button>
          </div>
        </NotAvailableForReadOnlyUser>
      </NotAvailableForGuest>
    );
  }, [
    deleteAllButtonClickedHandler,
    merged.isEmpty,
    selectAllCheckboxChangedHandler,
    selectedCount,
    t,
  ]);

  const searchControl = useMemo(() => {
    return (
      <SearchControl
        isEnableSort
        isEnableFilter
        disableUserPages={disableUserPages}
        initialSearchConditions={initialSearchConditions}
        onSearchInvoked={searchInvokedHandler}
        extraControls={extraControls}
        collapseContents={collapseContents}
        isCollapsed={isCollapsed}
      />
    );
  }, [
    extraControls,
    collapseContents,
    initialSearchConditions,
    isCollapsed,
    disableUserPages,
    searchInvokedHandler,
  ]);

  const searchResultListHead = useMemo(() => {
    // While the first chunk is still loading there is no meta yet; render
    // nothing so the "0 hits" message is not shown prematurely.
    if (swr.data == null) {
      return <></>;
    }
    return <SearchResultListHead total={merged.total} took={merged.took} />;
  }, [swr.data, merged.total, merged.took]);

  return (
    <SearchPageBase
      className={styles['search-page']}
      ref={searchPageBaseRef}
      pages={merged.pages}
      searchingKeyword={keyword}
      resetKey={resetKey}
      onSelectedPagesByCheckboxesChanged={
        selectedPagesByCheckboxesChangedHandler
      }
      // Components
      searchControl={searchControl}
      searchResultListHead={searchResultListHead}
      infiniteScroll={{
        swrInfiniteResponse: swr,
        isReachingEnd:
          merged.isReachingEnd || hasError || reachedResultWindowLimit,
        hasError,
        onRetry,
      }}
    />
  );
};
