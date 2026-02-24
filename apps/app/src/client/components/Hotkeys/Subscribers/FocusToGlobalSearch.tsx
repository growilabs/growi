import { useEffect } from 'react';

import {
  useSearchModalActions,
  useSearchModalStatus,
} from '~/features/search/client/states/modal/search';
import { useIsEditable } from '~/states/page';

type Props = {
  onDeleteRender: () => void;
};

const FocusToGlobalSearch = ({ onDeleteRender }: Props): null => {
  const isEditable = useIsEditable();
  const searchModalData = useSearchModalStatus();
  const { open: openSearchModal } = useSearchModalActions();

  useEffect(() => {
    if (!isEditable) {
      return;
    }

    if (!searchModalData.isOpened) {
      openSearchModal();
      onDeleteRender();
    }
  }, [isEditable, openSearchModal, onDeleteRender, searchModalData.isOpened]);

  return null;
};

export { FocusToGlobalSearch };
