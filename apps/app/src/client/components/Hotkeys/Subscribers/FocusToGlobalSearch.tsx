import { useEffect } from 'react';

import {
  useSearchModalActions,
  useSearchModalStatus,
} from '~/features/search/client/states/modal/search.js';
import { useIsEditable } from '~/states/page/index.js';

import type { HotkeyBindingDef } from '../HotkeysManager.js';

type Props = {
  onDeleteRender: () => void;
};

export const hotkeyBindings: HotkeyBindingDef = {
  keys: '/',
  category: 'single',
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
