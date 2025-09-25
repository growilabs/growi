import type { ForwardRefRenderFunction, JSX } from 'react';
import React, {
  forwardRef, useEffect, useImperativeHandle, useRef, useState,
} from 'react';

import { LoadingSpinner } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';
import dynamic from 'next/dynamic';

import type { ISelectableAll } from '~/client/interfaces/selectable-all';
import { toastSuccess } from '~/client/util/toastr';
import type { IFormattedSearchResult, IPageWithSearchMeta } from '~/interfaces/search';
import type { OnDeletedFunction } from '~/interfaces/ui';
import {
  useIsGuestUser, useIsReadOnlyUser, useIsSearchServiceConfigured, useIsSearchServiceReachable,
} from '~/stores-universal/context';
import { usePageDeleteModal } from '~/stores/modal';
import { mutatePageTree, mutateRecentlyUpdated } from '~/stores/page-listing';

import type { ForceHideMenuItems } from '../Common/Dropdown/PageItemControl';

// Do not import with next/dynamic
// see: https://github.com/growilabs/growi/pull/7923
import { SearchResultList } from './SearchResultList';

import styles from './SearchPageBase.module.scss';

// https://regex101.com/r/brrkBu/1
const highlightKeywordsSplitter = new RegExp('"[^"]+"|[^\u{20}\u{3000}]+', 'ug');


export interface IReturnSelectedPageIds {
  getSelectedPageIds?: () => Set<string>,
}


type Props = {
  className?: string,
  pages?: IPageWithSearchMeta[],
  searchingKeyword?: string,

  forceHideMenuItems?: ForceHideMenuItems,

  onSelectedPagesByCheckboxesChanged?: (selectedCount: number, totalCount: number) => void,

  searchControl: React.ReactNode,
  searchResultListHead: JSX.Element,
  searchPager: React.ReactNode,
}

const SearchResultContent = dynamic(() => import('./SearchResultContent').then(mod => mod.SearchResultContent), {
  ssr: false,
  loading: () => <></>,
});
const SearchPageBaseSubstance: ForwardRefRenderFunction<ISelectableAll & IReturnSelectedPageIds, Props> = (props: Props, ref) => {

  const {
    className,
    pages,
    searchingKeyword,
    forceHideMenuItems,
    onSelectedPagesByCheckboxesChanged,
    searchControl, searchResultListHead, searchPager,
  } = props;

  const searchResultListRef = useRef<ISelectableAll | null>(null);

  const { data: isGuestUser } = useIsGuestUser();
  const { data: isReadOnlyUser } = useIsReadOnlyUser();
  const { data: isSearchServiceConfigured } = useIsSearchServiceConfigured();
  const { data: isSearchServiceReachable } = useIsSearchServiceReachable();

  const [selectedPageIdsByCheckboxes] = useState<Set<string>>(new Set());
  // const [allPageIds] = useState<Set<string>>(new Set());

  const [selectedPageWithMeta, setSelectedPageWithMeta] = useState<IPageWithSearchMeta | undefined>();

  // publish selectAll()
  useImperativeHandle(ref, () => ({
    selectAll: () => {
      const instance = searchResultListRef.current;
      if (instance != null) {
        instance.selectAll();
      }

      if (pages != null) {
        pages.forEach(page => selectedPageIdsByCheckboxes.add(page.data._id));
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
    if ((pages == null || pages.length === 0)) {
      setSelectedPageWithMeta(undefined);
    }
    else if ((pages != null && pages.length > 0)) {
      setSelectedPageWithMeta(pages[0]);
    }
  }, [pages, setSelectedPageWithMeta]);

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
            <h1>Search service occures errors. Please contact to administrators of this system.</h1>
          </div>
        </div>
      </div>
    );
  }

  const highlightKeywords = searchingKeyword != null
    // Remove double quotation marks before and after a keyword if present
    // https://regex101.com/r/4QKBwg/1
    ? searchingKeyword.match(highlightKeywordsSplitter)?.map(keyword => keyword.replace(/^"(.*)"$/, '$1')) ?? undefined
    : undefined;

  return (
    <div className={`${className ?? ''} search-result-base flex-grow-1 d-flex flex-expand-vh-100`} data-testid="search-result-base">

      <div className="flex-expand-vert border boder-gray search-result-list" id="search-result-list">

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
              <div className="my-3 px-md-4 px-3">
                {searchResultListHead}
              </div>

              {pages.length > 0 && (
                <div className={`page-list ${styles['page-list']} px-md-4`}>
                  <SearchResultList
                    ref={searchResultListRef}
                    pages={pages}
                    selectedPageId={selectedPageWithMeta?.data._id}
                    forceHideMenuItems={forceHideMenuItems}
                    onPageSelected={page => (setSelectedPageWithMeta(page))}
                    onCheckboxChanged={checkboxChangedHandler}
                  />
                </div>
              )}
              <div className="my-4 d-flex justify-content-center">
                {searchPager}
              </div>
            </>
          )}

        </div>

      </div>

      <div className={`${styles['search-result-content']} flex-expand-vert d-none d-lg-flex`}>
        {pages != null && pages.length !== 0 && selectedPageWithMeta != null && (
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
    data: IFormattedSearchResult | undefined,
    ref: React.MutableRefObject<(ISelectableAll & IReturnSelectedPageIds) | null>,
    onDeleted?: OnDeletedFunction,
): VoidFunction => {

  const { t } = useTranslation();

  const { open: openDeleteModal } = usePageDeleteModal();

  return () => {
    if (data == null) {
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

    const selectedPages = data.data
      .filter(pageWithMeta => selectedPageIds.has(pageWithMeta.data._id));

    openDeleteModal(selectedPages, {
      onDeleted: (...args) => {
        const path = args[0];
        const isCompletely = args[2];
        if (path == null || isCompletely == null) {
          toastSuccess(t('deleted_page'));
        }
        else {
          toastSuccess(t('deleted_pages_completely', { path }));
        }
        mutatePageTree();
        mutateRecentlyUpdated();

        if (onDeleted != null) {
          onDeleted(...args);
        }
      },
    });
  };

};


export const SearchPageBase = forwardRef(SearchPageBaseSubstance);
