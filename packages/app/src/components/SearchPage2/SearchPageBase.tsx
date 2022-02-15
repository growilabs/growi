import React, {
  forwardRef, ForwardRefRenderFunction, useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import { ISelectableAll } from '~/client/interfaces/selectable-all';
import AppContainer from '~/client/services/AppContainer';
import { IPageWithMeta } from '~/interfaces/page';
import { IPageSearchMeta } from '~/interfaces/search';
import { useIsGuestUser } from '~/stores/context';

import { SearchResultContent } from '../SearchPage/SearchResultContent';
import { SearchResultList } from '../SearchPage/SearchResultList';

type Props = {
  appContainer: AppContainer,

  pages?: IPageWithMeta<IPageSearchMeta>[],

  onSelectedPagesByCheckboxesChanged?: (selectedCount: number, totalCount: number) => void,

  searchControl: React.ReactNode,
  searchResultListHead: React.ReactNode,
  searchPager: React.ReactNode,
}

const SearchPageBaseSubstance: ForwardRefRenderFunction<ISelectableAll, Props> = (props:Props, ref) => {
  const {
    appContainer,
    pages,
    onSelectedPagesByCheckboxesChanged,
    searchControl, searchResultListHead, searchPager,
  } = props;

  const searchResultListRef = useRef<ISelectableAll|null>(null);

  const { data: isGuestUser } = useIsGuestUser();

  // TODO get search keywords and split
  // ref: RevisionRenderer
  //   [...keywords.match(/"[^"]+"|[^\u{20}\u{3000}]+/ug)].forEach((keyword, i) => {
  const [highlightKeywords, setHightlightKeywords] = useState<string[]>([]);
  const [selectedPageIdsByCheckboxes] = useState<Set<string>>(new Set());
  // const [allPageIds] = useState<Set<string>>(new Set());
  const [selectedPageWithMeta, setSelectedPageWithMeta] = useState<IPageWithMeta<IPageSearchMeta> | undefined>();

  // publish selectAll()
  useImperativeHandle(ref, () => ({
    selectAll: () => {
      const instance = searchResultListRef.current;
      if (instance != null) {
        instance.selectAll();
      }

      if (pages != null) {
        pages.forEach(page => selectedPageIdsByCheckboxes.add(page.pageData._id));
      }
    },
    deselectAll: () => {
      const instance = searchResultListRef.current;
      if (instance != null) {
        instance.deselectAll();
      }

      selectedPageIdsByCheckboxes.clear();
    },
  }));

  const checkboxChangedHandler = (isChecked: boolean, pageId: string) => {
    if (pages == null || pages.length === 0) {
      return;
    }

    if (isChecked) {
      selectedPageIdsByCheckboxes.add(pageId);
    }
    else {
      selectedPageIdsByCheckboxes.delete(pageId);
    }

    if (onSelectedPagesByCheckboxesChanged != null) {
      onSelectedPagesByCheckboxesChanged(selectedPageIdsByCheckboxes.size, pages.length);
    }
  };

  // select first item on load
  useEffect(() => {
    if (selectedPageWithMeta == null && pages != null && pages.length > 0) {
      setSelectedPageWithMeta(pages[0]);
    }
  }, [pages, selectedPageWithMeta]);

  // reset selectedPageIdsByCheckboxes
  useEffect(() => {
    if (pages == null) {
      return;
    }

    if (pages.length > 0) {
      selectedPageIdsByCheckboxes.clear();
    }

    if (onSelectedPagesByCheckboxesChanged != null) {
      onSelectedPagesByCheckboxesChanged(selectedPageIdsByCheckboxes.size, pages.length);
    }
  }, [onSelectedPagesByCheckboxesChanged, pages, selectedPageIdsByCheckboxes]);

  const isLoading = pages == null;

  return (
    <div className="content-main">
      <div className="search-result d-flex" id="search-result">

        <div className="mw-0 flex-grow-1 flex-basis-0 border boder-gray search-result-list" id="search-result-list">

          {searchControl}

          <div className="search-result-list-scroll">

            { isLoading && (
              <div className="mw-0 flex-grow-1 flex-basis-0 m-5 text-muted text-center">
                <i className="fa fa-2x fa-spinner fa-pulse mr-1"></i>
              </div>
            ) }

            { !isLoading && (
              <>
                <div className="my-3 px-md-4">
                  {searchResultListHead}
                </div>
                <div className="page-list px-md-4">
                  <SearchResultList
                    ref={searchResultListRef}
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    pages={pages!}
                    selectedPageId={selectedPageWithMeta?.pageData._id}
                    onPageSelected={page => setSelectedPageWithMeta(page)}
                    onCheckboxChanged={checkboxChangedHandler}
                  />
                </div>
                <div className="my-4 d-flex justify-content-center">
                  {searchPager}
                </div>
              </>
            ) }

          </div>

        </div>

        <div className="mw-0 flex-grow-1 flex-basis-0 d-none d-lg-block search-result-content">
          { selectedPageWithMeta != null && (
            <SearchResultContent
              appContainer={appContainer}
              pageWithMeta={selectedPageWithMeta}
              highlightKeywords={highlightKeywords}
              showPageControlDropdown={isGuestUser}
            />
          )}
        </div>

      </div>
    </div>
  );
};


export const SearchPageBase = forwardRef(SearchPageBaseSubstance);
