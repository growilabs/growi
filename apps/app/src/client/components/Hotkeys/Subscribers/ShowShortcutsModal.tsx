import { useEffect } from 'react';

import {
  useShortcutsModalActions,
  useShortcutsModalStatus,
} from '~/states/ui/modal/shortcuts';

import type { HotkeyBindingDef } from '../HotkeysManager';

type Props = {
  onDeleteRender: () => void;
};

export const hotkeyBindings: HotkeyBindingDef = {
  keys: ['Control+/', 'Meta+/'],
  category: 'modifier',
};

const ShowShortcutsModal = ({ onDeleteRender }: Props): null => {
  const status = useShortcutsModalStatus();
  const { open } = useShortcutsModalActions();

  useEffect(() => {
    if (status == null) {
      return;
    }

    if (!status.isOpened) {
      open();
      onDeleteRender();
    }
  }, [onDeleteRender, open, status]);

  return null;
};

export { ShowShortcutsModal };
