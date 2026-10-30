import { type JSX, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Downshift, {
  type DownshiftState,
  type StateChangeOptions,
} from 'downshift';
import { useAtomValue } from 'jotai';
import { Modal, ModalBody } from 'reactstrap';

import { toSearchHistoryKeyword } from '~/features/search/utils/search-history-keyword';
import { useCurrentUser } from '~/states/global';
import { useCurrentPagePath } from '~/states/page';
import { useSetSearchKeyword } from '~/states/search';
import { isSearchScopeChildrenAsDefaultAtom } from '~/states/server-configurations';

import type { DownshiftItem } from '../interfaces/downshift';
import { recordSearchHistory } from '../services/record-search-history';
import {
  useSearchModalActions,
  useSearchModalStatus,
} from '../states/modal/search';
import { SearchForm } from './SearchForm';
import { SearchHelp } from './SearchHelp';
import { SearchMethodMenuItem } from './SearchMethodMenuItem';
import { SearchResultMenuItem } from './SearchResultMenuItem';

type Props = {
  onSearch: (keyword: string) => void;
  onRecordSearch: (keyword: string) => void;
};

const SearchModalSubstance = (props: Props): JSX.Element => {
  const { onSearch, onRecordSearch } = props;

  const [searchInput, setSearchInput] = useState('');

  const searchModalData = useSearchModalStatus();
  const { close: closeSearchModal } = useSearchModalActions();
  const router = useRouter();

  const changeSearchTextHandler = useCallback((searchText: string) => {
    setSearchInput(searchText);
  }, []);

  const selectSearchMenuItemHandler = useCallback(
    async (selectedItem: DownshiftItem) => {
      if (selectedItem.type !== 'navigate') {
        return;
      }
      if (selectedItem.historyKeyword != null) {
        onRecordSearch(selectedItem.historyKeyword);
      }
      await router.push(selectedItem.url);
      closeSearchModal();
    },
    [closeSearchModal, onRecordSearch, router],
  );

  const submitHandler = useCallback(() => {
    onSearch(searchInput);
    closeSearchModal();
  }, [closeSearchModal, onSearch, searchInput]);

  // Memoize stateReducer to prevent recreation on every render
  const stateReducer = useCallback(
    (
      state: DownshiftState<DownshiftItem>,
      changes: StateChangeOptions<DownshiftItem>,
    ) => {
      // Do not update highlightedIndex on mouse hover
      if (changes.type === Downshift.stateChangeTypes.itemMouseEnter) {
        return {
          ...changes,
          highlightedIndex: state.highlightedIndex,
        };
      }

      return changes;
    },
    [],
  );

  useEffect(() => {
    if (!searchModalData?.isOpened) {
      return;
    }
    if (searchModalData?.searchKeyword == null) {
      setSearchInput('');
    } else {
      setSearchInput(searchModalData.searchKeyword);
    }
  }, [searchModalData?.isOpened, searchModalData?.searchKeyword]);

  return (
    <ModalBody className="pb-2">
      <Downshift
        onSelect={selectSearchMenuItemHandler}
        stateReducer={stateReducer}
        defaultIsOpen
      >
        {({
          getRootProps,
          getInputProps,
          getItemProps,
          getMenuProps,
          highlightedIndex,
        }) => (
          <div {...getRootProps({}, { suppressRefError: true })}>
            <div className="text-muted d-flex justify-content-center align-items-center p-1">
              <span className="material-symbols-outlined fs-4 me-3">
                search
              </span>
              <SearchForm
                searchKeyword={searchInput}
                onChange={changeSearchTextHandler}
                onSubmit={submitHandler}
                getInputProps={getInputProps}
              />
              <button
                type="button"
                className="btn border-0 d-flex justify-content-center p-0"
                onClick={closeSearchModal}
              >
                <span className="material-symbols-outlined fs-4 ms-3 py-0">
                  close
                </span>
              </button>
            </div>

            <ul {...getMenuProps()} className="list-unstyled m-0">
              <div className="border-top mt-2 mb-2" />
              <SearchMethodMenuItem
                activeIndex={highlightedIndex}
                searchKeyword={searchInput}
                getItemProps={getItemProps}
              />
              <SearchResultMenuItem
                activeIndex={highlightedIndex}
                searchKeyword={searchInput}
                getItemProps={getItemProps}
              />
              <div className="border-top mt-2 mb-2" />
            </ul>
          </div>
        )}
      </Downshift>
      <SearchHelp />
    </ModalBody>
  );
};

const SearchModal = (): JSX.Element => {
  const { isOpened, onSearchOverride, isSearchHistoryEnabled } =
    useSearchModalStatus();
  const { close: closeSearchModal } = useSearchModalActions();

  const setSearchKeyword = useSetSearchKeyword();
  const isSearchScopeChildrenAsDefault = useAtomValue(
    isSearchScopeChildrenAsDefaultAtom,
  );
  const currentPagePath = useCurrentPagePath();
  const currentUser = useCurrentUser();

  const recordSearch = useCallback(
    (keyword: string) => {
      if (currentUser == null || !isSearchHistoryEnabled) {
        return;
      }
      const historyKeyword = toSearchHistoryKeyword(keyword);
      if (historyKeyword == null) {
        return;
      }
      recordSearchHistory(historyKeyword);
    },
    [currentUser, isSearchHistoryEnabled],
  );

  const searchHandler = useCallback(
    (keyword: string) => {
      // Record before the override and the prefix: below so neither affects the saved keyword
      recordSearch(keyword);

      // invoke override function if exists
      if (onSearchOverride != null) {
        onSearchOverride(keyword);
        return;
      }

      // Respect the admin setting: scope search to the current page tree by default
      const shouldScopeToChildren =
        isSearchScopeChildrenAsDefault && currentPagePath != null;
      const finalKeyword = shouldScopeToChildren
        ? `prefix:${currentPagePath} ${keyword}`
        : keyword;

      setSearchKeyword(finalKeyword);
    },
    [
      recordSearch,
      onSearchOverride,
      setSearchKeyword,
      isSearchScopeChildrenAsDefault,
      currentPagePath,
    ],
  );

  return (
    <Modal
      size="lg"
      isOpen={isOpened}
      toggle={closeSearchModal}
      data-testid="search-modal"
    >
      {isOpened && (
        <SearchModalSubstance
          onSearch={searchHandler}
          onRecordSearch={recordSearch}
        />
      )}
    </Modal>
  );
};

export default SearchModal;
