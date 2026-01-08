import React, { type JSX, useCallback, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'next-i18next';

import { NotAvailableForGuest } from '~/client/components/NotAvailableForGuest';
import { NotAvailableForReadOnlyUser } from '~/client/components/NotAvailableForReadOnlyUser';
import PaginationWrapper from '~/client/components/PaginationWrapper';
import type {
  ISelectableAll,
  ISelectableAndIndeterminatable,
} from '~/client/interfaces/selectable-all';
import type { IFormattedSearchResult } from '~/interfaces/search';
import { useSearchKeyword, useSetSearchKeyword } from '~/states/search';
import { showPageLimitationLAtom } from '~/states/server-configurations';
import {
  type ISearchConditions,
  type ISearchConfigurations,
  useSWRxSearch,
} from '~/stores/search';

import { OperateAllControl } from './OperateAllControl';
import SearchControl from './SearchControl';
import type { IReturnSelectedPageIds } from './SearchPageBase';
import {
  SearchPageBase,
  usePageDeleteModalForBulkDeletion,
} from './SearchPageBase';

import styles from './SearchPage.module.scss';

// TODO: replace with "customize:showPageLimitationS"
const INITIAL_PAGIONG_SIZE = 20;

/**
 * SearchResultListHead
 */

type SearchResultListHeadProps = {
  searchResult: IFormattedSearchResult;
  pagingSize: number;
  onPagingSizeChanged: (size: number) => void;
};

const SearchResultListHead = React.memo(
  (props: SearchResultListHeadProps): JSX.Element => {
    const { t } = useTranslation();

    const {
      searchResult, // pagingSize, onPagingSizeChanged,
    } = props;

    const { took, total } = searchResult.meta;

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
        {/* TODO: infinite scroll for search result */}
        {/* <div className="input-group flex-nowrap search-result-select-group ms-auto d-md-flex d-none">
        <div>
          <label className="form-label input-group-text text-muted" htmlFor="inputGroupSelect01">{t('search_result.number_of_list_to_display')}</label>
        </div>
        <select
          defaultValue={pagingSize}
          className="form-select"
          id="inputGroupSelect01"
          onChange={e => onPagingSizeChanged(Number(e.target.value))}
        >
          {[20, 50, 100, 200].map((limit) => {
            return <option key={limit} value={limit}>{limit} {t('search_result.page_number_unit')}</option>;
          })}
        </select>
      </div> */}
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

  const [offset, setOffset] = useState<number>(0);
  const [limit, setLimit] = useState<number>(
    showPageLimitationL ?? INITIAL_PAGIONG_SIZE,
  );
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

  const { data, conditions, mutate } = useSWRxSearch(keyword ?? '', null, {
    ...configurationsByControl,
    offset,
    limit,
  });

  const searchInvokedHandler = useCallback(
    (newKeyword: string, newConfigurations: Partial<ISearchConfigurations>) => {
      setOffset(0);
      setConfigurationsByControl(newConfigurations);

      setSearchKeyword(newKeyword);

      mutate();
    },
    [mutate, setSearchKeyword],
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

  const pagingSizeChangedHandler = useCallback(
    (pagingSize: number) => {
      setOffset(0);
      setLimit(pagingSize);
      mutate();
    },
    [mutate],
  );

  const pagingNumberChangedHandler = useCallback(
    (activePage: number) => {
      setOffset((activePage - 1) * limit);
      mutate();
    },
    [limit, mutate],
  );

  const initialSearchConditions: Partial<ISearchConditions> = useMemo(() => {
    return {
      keyword,
      limit: INITIAL_PAGIONG_SIZE,
    };
  }, [keyword]);

  // for bulk deletion
  const deleteAllButtonClickedHandler = usePageDeleteModalForBulkDeletion(
    data,
    searchPageBaseRef,
    () => mutate(),
  );

  const hitsCount = data?.meta.hitsCount;

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
                isCheckboxDisabled={hitsCount === 0}
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
    hitsCount,
    selectAllCheckboxChangedHandler,
    selectedCount,
    t,
  ]);

  const searchControl = useMemo(() => {
    return (
      <SearchControl
        isEnableSort
        isEnableFilter
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
    searchInvokedHandler,
  ]);

  const searchResultListHead = useMemo(() => {
    if (data == null) {
      return <></>;
    }
    return (
      <SearchResultListHead
        searchResult={data}
        pagingSize={limit}
        onPagingSizeChanged={pagingSizeChangedHandler}
      />
    );
  }, [data, limit, pagingSizeChangedHandler]);

  const searchPager = useMemo(() => {
    // when pager is not needed
    if (data == null || data.meta.hitsCount === data.meta.total) {
      return <></>;
    }

    const { total } = data.meta;
    const { offset, limit } = conditions;

    return (
      <PaginationWrapper
        activePage={Math.floor(offset / limit) + 1}
        totalItemsCount={total}
        pagingLimit={limit}
        changePage={pagingNumberChangedHandler}
      />
    );
  }, [conditions, data, pagingNumberChangedHandler]);

  return (
    <SearchPageBase
      className={styles['search-page']}
      ref={searchPageBaseRef}
      pages={data?.data}
      searchingKeyword={keyword}
      onSelectedPagesByCheckboxesChanged={
        selectedPagesByCheckboxesChangedHandler
      }
      // Components
      searchControl={searchControl}
      searchResultListHead={searchResultListHead}
      searchPager={searchPager}
    />
  );
};
