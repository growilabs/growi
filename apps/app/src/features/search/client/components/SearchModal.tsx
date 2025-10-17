import Downshift, {
  type DownshiftState,
  type StateChangeOptions,
} from 'downshift';
import { useRouter } from 'next/router';
import React, { type JSX, useCallback, useEffect, useState } from 'react';
import { Modal, ModalBody } from 'reactstrap';

import { isIncludeAiMenthion, removeAiMenthion } from '../../utils/ai';
import type { DownshiftItem } from '../interfaces/downshift';
import { useSearchModal } from '../stores/search';

import { SearchForm } from './SearchForm';
import { SearchHelp } from './SearchHelp';
import { SearchMethodMenuItem } from './SearchMethodMenuItem';
import { SearchResultMenuItem } from './SearchResultMenuItem';

const SearchModal = (): JSX.Element => {
  const [searchKeyword, setSearchKeyword] = useState('');
  const [isMenthionedToAi, setMenthionedToAi] = useState(false);

  const { data: searchModalData, close: closeSearchModal } = useSearchModal();

  const router = useRouter();

  const changeSearchTextHandler = useCallback((searchText: string) => {
    setSearchKeyword(searchText);
  }, []);

  const selectSearchMenuItemHandler = useCallback(
    (selectedItem: DownshiftItem) => {
      router.push(selectedItem.url);
      closeSearchModal();
    },
    [closeSearchModal, router],
  );

  const submitHandler = useCallback(() => {
    const url = new URL('_search', 'http://example.com');
    url.searchParams.set('q', searchKeyword);
    router.push(url.pathname + url.search);
    closeSearchModal();
  }, [closeSearchModal, router, searchKeyword]);

  const stateReducer = (
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
  };

  useEffect(() => {
    if (!searchModalData?.isOpened) {
      return;
    }
    if (searchModalData?.searchKeyword == null) {
      setSearchKeyword('');
    } else {
      setSearchKeyword(searchModalData.searchKeyword);
    }
  }, [searchModalData?.isOpened, searchModalData?.searchKeyword]);

  useEffect(() => {
    setMenthionedToAi(isIncludeAiMenthion(searchKeyword));
  }, [searchKeyword]);

  const searchKeywordWithoutAi = removeAiMenthion(searchKeyword);

  return (
    <Modal
      size="lg"
      isOpen={searchModalData?.isOpened ?? false}
      toggle={closeSearchModal}
      data-testid="search-modal"
    >
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
                <span
                  className={`material-symbols-outlined fs-4 me-3 ${isMenthionedToAi ? 'text-primary' : ''}`}
                >
                  {isMenthionedToAi ? 'psychology' : 'search'}
                </span>
                <SearchForm
                  searchKeyword={searchKeyword}
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
                  searchKeyword={searchKeywordWithoutAi}
                  getItemProps={getItemProps}
                />
                <SearchResultMenuItem
                  activeIndex={highlightedIndex}
                  searchKeyword={searchKeywordWithoutAi}
                  getItemProps={getItemProps}
                />
                <div className="border-top mt-2 mb-2" />
              </ul>
            </div>
          )}
        </Downshift>
        <SearchHelp />
      </ModalBody>
    </Modal>
  );
};

export default SearchModal;
