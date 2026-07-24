import React, {
  type JSX,
  useCallback,
  useEffect,
  useId,
  useState,
} from 'react';
import { useTranslation } from 'next-i18next';
import { Collapse } from 'reactstrap';

import { SORT_AXIS, SORT_ORDER } from '~/interfaces/search';
import type { ISearchConditions, ISearchConfigurations } from '~/stores/search';

import {
  createEmptyFilterState,
  type SearchFilterState,
} from '../../utils/search-query';
import { SearchFilterPanel } from './SearchFilterPanel';
import { SearchModalTriggerinput } from './SearchModalTriggerinput';
import { SearchOptionModalLazyLoaded } from './SearchOptionModal';
import SortControl from './SortControl';

type Props = {
  isEnableSort: boolean;
  isEnableFilter: boolean;
  disableUserPages: boolean;
  initialSearchConditions: Partial<ISearchConditions>;

  onSearchInvoked?: (
    keyword: string,
    configurations: Partial<ISearchConfigurations>,
  ) => void;

  extraControls: React.ReactNode;

  collapseContents?: React.ReactNode;
  isCollapsed?: boolean;
};

const SearchControl = React.memo((props: Props): JSX.Element => {
  const {
    isEnableSort,
    isEnableFilter,
    disableUserPages,
    initialSearchConditions,
    onSearchInvoked,
    extraControls,
    collapseContents,
    isCollapsed,
  } = props;

  const keywordOnInit = initialSearchConditions.keyword ?? '';

  const [keyword, setKeyword] = useState(keywordOnInit);
  const [sort, setSort] = useState<SORT_AXIS>(
    initialSearchConditions.sort ?? SORT_AXIS.RELATION_SCORE,
  );
  const [order, setOrder] = useState<SORT_ORDER>(
    initialSearchConditions.order ?? SORT_ORDER.DESC,
  );
  const [includeUserPages, setIncludeUserPages] = useState(
    initialSearchConditions.includeUserPages ?? false,
  );
  const [includeTrashPages, setIncludeTrashPages] = useState(
    initialSearchConditions.includeTrashPages ?? false,
  );
  const [filters, setFilters] = useState<SearchFilterState>(
    initialSearchConditions.filters ?? createEmptyFilterState(),
  );
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  // Defer mounting the filter panel (and its data fetches) until first opened, so
  // an unopened panel adds no work to the search-results page load.
  const [hasOpenedFilterPanel, setHasOpenedFilterPanel] = useState(false);
  const [isFileterOptionModalShown, setIsFileterOptionModalShown] =
    useState(false);
  const filterPanelId = useId();

  const { t } = useTranslation('');

  // Every control change re-runs the search with the full configuration. This
  // helper assembles that payload from current state so each handler only passes
  // the field it changed. The changed value must be passed as an override rather
  // than read back from state, since the state setter has not applied yet.
  const invokeSearch = useCallback(
    (nextKeyword: string, overrides?: Partial<ISearchConfigurations>) => {
      onSearchInvoked?.(nextKeyword, {
        sort,
        order,
        includeUserPages,
        includeTrashPages,
        filters,
        ...overrides,
      });
    },
    [
      filters,
      includeTrashPages,
      includeUserPages,
      onSearchInvoked,
      order,
      sort,
    ],
  );

  const searchBySearchControlHandler = useCallback(
    (newKeyword: string) => {
      setKeyword(newKeyword);
      invokeSearch(newKeyword);
    },
    [invokeSearch],
  );

  const changeSortHandler = useCallback(
    (nextSort: SORT_AXIS, nextOrder: SORT_ORDER) => {
      setSort(nextSort);
      setOrder(nextOrder);
      invokeSearch(keyword, { sort: nextSort, order: nextOrder });
    },
    [invokeSearch, keyword],
  );

  const changeIncludeUserPagesHandler = useCallback(
    (include: boolean) => {
      setIncludeUserPages(include);
      invokeSearch(keyword, { includeUserPages: include });
    },
    [invokeSearch, keyword],
  );

  const changeIncludeTrashPagesHandler = useCallback(
    (include: boolean) => {
      setIncludeTrashPages(include);
      invokeSearch(keyword, { includeTrashPages: include });
    },
    [invokeSearch, keyword],
  );

  const changeFiltersHandler = useCallback(
    (newFilters: SearchFilterState) => {
      setFilters(newFilters);
      invokeSearch(keyword, { filters: newFilters });
    },
    [invokeSearch, keyword],
  );

  useEffect(() => {
    setKeyword(keywordOnInit);
  }, [keywordOnInit]);

  return (
    <div className="shadow-sm">
      <div className="grw-search-page-nav d-flex py-3 align-items-center">
        <div className="flex-grow-1 mx-4">
          <SearchModalTriggerinput
            keywordOnInit={keyword}
            onSearchInvoked={searchBySearchControlHandler}
          />
        </div>
      </div>
      {/* TODO: replace the following elements deleteAll button , relevance button and include specificPath button component */}
      <div className="search-control d-flex align-items-center py-md-2 py-3 px-md-4 px-3 border-bottom border-gray">
        {/* sort option */}
        {isEnableSort && (
          <div className="flex-grow-1">
            <SortControl
              sort={sort}
              order={order}
              onChange={changeSortHandler}
            />
          </div>
        )}
        {/* filter option */}
        {isEnableFilter && (
          <>
            <div className="d-lg-none">
              <button
                type="button"
                className="btn"
                onClick={() => setIsFileterOptionModalShown(true)}
              >
                <span className="material-symbols-outlined">tune</span>
              </button>
            </div>
            <div className="d-none d-lg-flex align-items-center search-control-include-options">
              {disableUserPages === false && (
                <div className="px-2 py-1">
                  <div className="form-check form-check-succsess">
                    <input
                      className="form-check-input me-2"
                      type="checkbox"
                      id="flexCheckDefault"
                      defaultChecked={includeUserPages}
                      onChange={(e) =>
                        changeIncludeUserPagesHandler(e.target.checked)
                      }
                    />
                    <label
                      className="form-label form-check-label mb-0 d-flex align-items-center text-secondary with-no-font-weight"
                      htmlFor="flexCheckDefault"
                    >
                      {t('Include Subordinated Target Page', {
                        target: '/user',
                      })}
                    </label>
                  </div>
                </div>
              )}
              <div className="px-2 py-1">
                <div className="form-check form-check-succsess">
                  <input
                    className="form-check-input me-2"
                    type="checkbox"
                    id="flexCheckChecked"
                    checked={includeTrashPages}
                    onChange={(e) =>
                      changeIncludeTrashPagesHandler(e.target.checked)
                    }
                  />
                  <label
                    className="form-label form-check-label mb-0 d-flex align-items-center text-secondary with-no-font-weight"
                    htmlFor="flexCheckChecked"
                  >
                    {t('Include Subordinated Target Page', {
                      target: '/trash',
                    })}
                  </label>
                </div>
              </div>
            </div>
            <div className="d-none d-lg-block ms-2">
              <button
                type="button"
                className={`btn btn-outline-secondary d-flex align-items-center ${
                  isFilterPanelOpen ? 'active' : ''
                }`}
                aria-expanded={isFilterPanelOpen}
                aria-controls={filterPanelId}
                onClick={() => {
                  setHasOpenedFilterPanel(true);
                  setIsFilterPanelOpen((prev) => !prev);
                }}
              >
                <span className="material-symbols-outlined fs-5 me-1">
                  tune
                </span>
                {t('search_result.filter', 'Filters')}
              </button>
            </div>
          </>
        )}

        {extraControls}
      </div>

      {isEnableFilter && (
        <Collapse isOpen={isFilterPanelOpen}>
          <div id={filterPanelId} className="border-bottom border-gray">
            {hasOpenedFilterPanel && (
              <SearchFilterPanel
                filters={filters}
                onChange={changeFiltersHandler}
              />
            )}
          </div>
        </Collapse>
      )}

      {collapseContents != null && (
        <Collapse isOpen={isCollapsed}>{collapseContents}</Collapse>
      )}

      <SearchOptionModalLazyLoaded
        isOpen={isFileterOptionModalShown || false}
        onClose={() => setIsFileterOptionModalShown(false)}
        disableUserPages={disableUserPages}
        includeUserPages={includeUserPages}
        includeTrashPages={includeTrashPages}
        onIncludeUserPagesSwitched={changeIncludeUserPagesHandler}
        onIncludeTrashPagesSwitched={changeIncludeTrashPagesHandler}
        isEnableFilter={isEnableFilter}
        filters={filters}
        onFiltersChange={changeFiltersHandler}
      />
    </div>
  );
});

SearchControl.displayName = 'SearchControl';

export default SearchControl;
