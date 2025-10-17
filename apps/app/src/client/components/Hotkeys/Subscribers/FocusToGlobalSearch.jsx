import { useEffect } from 'react';

import { useSearchModalStatus, useSearchModalActions } from '~/features/search/client/states/modal/search';
import { useIsEditable } from '~/states/page';


const FocusToGlobalSearch = (props) => {
  const isEditable = useIsEditable();
  const searchModalData = useSearchModalStatus();
  const { open: openSearchModal } = useSearchModalActions();

  // setup effect
  useEffect(() => {
    if (!isEditable) {
      return;
    }

    if (!searchModalData.isOpened) {
      openSearchModal();
      // remove this
      props.onDeleteRender();
    }

  }, [isEditable, openSearchModal, props, searchModalData.isOpened]);

  return null;
};

FocusToGlobalSearch.getHotkeyStrokes = () => {
  return [['/']];
};

export default FocusToGlobalSearch;
