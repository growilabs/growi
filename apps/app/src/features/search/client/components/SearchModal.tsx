import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Downshift, {
  type DownshiftState,
  type StateChangeOptions,
} from 'downshift';
import { Modal, ModalBody } from 'reactstrap';

import { useSetSearchKeyword } from '~/states/search';

import { isIncludeAiMenthion, removeAiMenthion } from '../../utils/ai';
import type { DownshiftItem } from '../interfaces/downshift';
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
};

const SearchModalSubstance = (props: Props): JSX.Element => {
  const { onSearch } = props;

  const [searchInput, setSearchInput] = useState('');
  const [isMenthionedToAi, setMenthionedToAi] = useState(false);

  const searchModalData = useSearchModalStatus();
  const { close: closeSearchModal } = useSearchModalActions();
  const router = useRouter();

  const changeSearchTextHandler = useCallback((searchText: string) => {
    setSearchInput(searchText);
  }, []);

  const selectSearchMenuItemHandler = useCallback(
    (selectedItem: DownshiftItem) => {
      router.push(selectedItem.url);
      closeSearchModal();
    },
    [closeSearchModal, router],
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

  useEffect(() => {
    setMenthionedToAi(isIncludeAiMenthion(searchInput));
  }, [searchInput]);

  // Memoize AI mention removal to prevent recalculation on every render
  const searchInputWithoutAi = useMemo(
    () => removeAiMenthion(searchInput),
    [searchInput],
  );

  // Memoize icon selection to prevent recalculation
  const searchIcon = useMemo(
    () => (isMenthionedToAi ? 'psychology' : 'search'),
    [isMenthionedToAi],
  );

  // Memoize icon class to prevent string concatenation on every render
  const iconClassName = useMemo(
    () =>
      `material-symbols-outlined fs-4 me-3 ${isMenthionedToAi ? 'text-primary' : ''}`,
    [isMenthionedToAi],
  );

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
              <span className={iconClassName}>{searchIcon}</span>
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
                searchKeyword={searchInputWithoutAi}
                getItemProps={getItemProps}
              />
              <SearchResultMenuItem
                activeIndex={highlightedIndex}
                searchKeyword={searchInputWithoutAi}
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
  const { isOpened, onSearchOverride } = useSearchModalStatus();
  const { close: closeSearchModal } = useSearchModalActions();

  const setSearchKeyword = useSetSearchKeyword();

  const searchHandler = useCallback(
    (keyword: string) => {
      // invoke override function if exists
      if (onSearchOverride != null) {
        onSearchOverride(keyword);
      } else {
        setSearchKeyword(keyword);
      }
    },
    [onSearchOverride, setSearchKeyword],
  );

  // Early return for performance optimization
  if (!isOpened) {
    return <></>;
  }

  return (
    <Modal
      size="lg"
      isOpen={isOpened}
      toggle={closeSearchModal}
      data-testid="search-modal"
    >
      <SearchModalSubstance onSearch={searchHandler} />
    </Modal>
  );
};

export default SearchModal;
