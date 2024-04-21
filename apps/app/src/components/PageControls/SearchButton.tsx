import React, { useCallback } from 'react';

import { useSearchModal } from '../../features/search/client/stores/search';

import styles from './SearchButton.module.scss';


const SearchButton = (): JSX.Element => {

  const { open: openSearchModal } = useSearchModal();

  const searchButtonClickHandler = useCallback(() => {
    openSearchModal();
  }, [openSearchModal]);


  return (
    <button
      type="button"
      className={`btn btn-search ${styles['btn-search']}`}
      onClick={searchButtonClickHandler}
      data-testid="open-search-modal-button"
    >
      <span className="material-symbols-outlined">search</span>
    </button>
  );
};

export default SearchButton;
