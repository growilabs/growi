import React, { useCallback } from 'react';

import { useSearchModalActions } from '../../states/modal/search';

type Props = {
  keywordOnInit: string;
  onSearchInvoked?: (keyword: string) => void;
};

// forwardRef exposes the inner <input> so callers can move keyboard focus here
// (e.g. after the filter-chip bar unmounts, see SearchControl).
export const SearchModalTriggerinput = React.forwardRef<
  HTMLInputElement,
  Props
>((props, ref) => {
  const { keywordOnInit, onSearchInvoked } = props;

  const { open: openSearchModal } = useSearchModalActions();

  const inputClickHandler = useCallback(() => {
    openSearchModal(keywordOnInit, onSearchInvoked);
  }, [openSearchModal, keywordOnInit, onSearchInvoked]);

  return (
    <div className="d-flex align-items-center">
      <span className="text-secondary material-symbols-outlined fs-4 me-2">
        search
      </span>
      <form
        className="w-100 position-relative"
        onClick={inputClickHandler}
        onKeyDown={inputClickHandler}
      >
        <input
          ref={ref}
          className="form-control"
          type="input"
          value={keywordOnInit}
          onClick={inputClickHandler}
          readOnly
        />
      </form>
    </div>
  );
});

SearchModalTriggerinput.displayName = 'SearchModalTriggerinput';
