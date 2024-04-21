import React, {
  useCallback, useEffect, useState,
} from 'react';

import { useTranslation } from 'next-i18next';

import { SORT_AXIS, SORT_ORDER } from '~/interfaces/search';
import type { ISearchConditions, ISearchConfigurations } from '~/stores/search';

import { SearchModalTriggerinput } from './SearchModalTriggerinput';
import SearchOptionModal from './SearchOptionModal';
import SortControl from './SortControl';

import styles from './SearchControl.module.scss';

type Props = {
  isSearchServiceReachable: boolean,
  isEnableSort: boolean,
  isEnableFilter: boolean,
  initialSearchConditions: Partial<ISearchConditions>,

  onSearchInvoked?: (keyword: string, configurations: Partial<ISearchConfigurations>) => void,

  allControl: React.ReactNode,
}

const SearchControl = React.memo((props: Props): JSX.Element => {

  const {
    isSearchServiceReachable,
    isEnableSort,
    isEnableFilter,
    initialSearchConditions,
    onSearchInvoked,
    allControl,
  } = props;

  const keywordOnInit = initialSearchConditions.keyword ?? '';

  const [keyword, setKeyword] = useState(keywordOnInit);
  const [sort, setSort] = useState<SORT_AXIS>(initialSearchConditions.sort ?? SORT_AXIS.RELATION_SCORE);
  const [order, setOrder] = useState<SORT_ORDER>(initialSearchConditions.order ?? SORT_ORDER.DESC);
  const [includeUserPages, setIncludeUserPages] = useState(initialSearchConditions.includeUserPages ?? false);
  const [includeTrashPages, setIncludeTrashPages] = useState(initialSearchConditions.includeTrashPages ?? false);
  const [isFileterOptionModalShown, setIsFileterOptionModalShown] = useState(false);

  const { t } = useTranslation('');

  const searchFormSubmittedHandler = useCallback((input: string) => {
    setKeyword(input);

    onSearchInvoked?.(input, {
      sort, order, includeUserPages, includeTrashPages,
    });
  }, [includeTrashPages, includeUserPages, onSearchInvoked, order, sort]);

  const changeSortHandler = useCallback((nextSort: SORT_AXIS, nextOrder: SORT_ORDER) => {
    setSort(nextSort);
    setOrder(nextOrder);

    onSearchInvoked?.(keyword, {
      sort: nextSort, order: nextOrder, includeUserPages, includeTrashPages,
    });
  }, [includeTrashPages, includeUserPages, keyword, onSearchInvoked]);

  const changeIncludeUserPagesHandler = useCallback((include: boolean) => {
    setIncludeUserPages(include);

    onSearchInvoked?.(keyword, {
      sort, order, includeUserPages: include, includeTrashPages,
    });
  }, [includeTrashPages, keyword, onSearchInvoked, order, sort]);

  const changeIncludeTrashPagesHandler = useCallback((include: boolean) => {
    setIncludeTrashPages(include);

    onSearchInvoked?.(keyword, {
      sort, order, includeUserPages, includeTrashPages: include,
    });
  }, [includeUserPages, keyword, onSearchInvoked, order, sort]);

  useEffect(() => {
    setKeyword(keywordOnInit);
  }, [keywordOnInit]);

  return (
    <div className="shadow-sm">
      <div className="grw-search-page-nav d-flex py-3 align-items-center">
        <div className="flex-grow-1 mx-4">
          <SearchModalTriggerinput
            keywordOnInit={keyword}
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
                <span className="material-symbols-outlined">
                  tune
                </span>
              </button>
            </div>
            <div className="d-none d-lg-flex align-items-center search-control-include-options">
              <div className="px-2 py-1">
                <div className="form-check form-check-succsess">
                  <input
                    className="form-check-input me-2"
                    type="checkbox"
                    id="flexCheckDefault"
                    defaultChecked={includeUserPages}
                    onChange={e => changeIncludeUserPagesHandler(e.target.checked)}
                  />
                  <label
                    className="form-label form-check-label mb-0 d-flex align-items-center text-secondary with-no-font-weight"
                    htmlFor="flexCheckDefault"
                  >
                    {t('Include Subordinated Target Page', { target: '/user' })}
                  </label>
                </div>
              </div>
              <div className="px-2 py-1">
                <div className="form-check form-check-succsess">
                  <input
                    className="form-check-input me-2"
                    type="checkbox"
                    id="flexCheckChecked"
                    checked={includeTrashPages}
                    onChange={e => changeIncludeTrashPagesHandler(e.target.checked)}
                  />
                  <label
                    className="form-label form-check-label mb-0 d-flex align-items-center text-secondary with-no-font-weight"
                    htmlFor="flexCheckChecked"
                  >
                    {t('Include Subordinated Target Page', { target: '/trash' })}
                  </label>
                </div>
              </div>
            </div>
          </>
        )}
        <div className="d-flex">
          <div className="btn-group">
            {/* TODO: imprv to delete all result UI */}
            {/* <button className={`btn btn-sm rounded ${styles['btn-delete']}`} type="button" data-bs-toggle="dropdown" aria-expanded="false">
              <span className="material-symbols-outlined ">delete</span>
              <span className="material-symbols-outlined ">expand_more</span>
            </button> */}
            {/* <ul className="dropdown-menu"> */}
            {allControl}
            {/* </ul> */}
          </div>
        </div>
      </div>

      <SearchOptionModal
        isOpen={isFileterOptionModalShown || false}
        onClose={() => setIsFileterOptionModalShown(false)}
        includeUserPages={includeUserPages}
        includeTrashPages={includeTrashPages}
        onIncludeUserPagesSwitched={setIncludeUserPages}
        onIncludeTrashPagesSwitched={setIncludeTrashPages}
      />

    </div>
  );
});

SearchControl.displayName = 'SearchControl';

export default SearchControl;
