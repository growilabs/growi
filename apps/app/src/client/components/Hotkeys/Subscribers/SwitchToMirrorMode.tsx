import { useEffect } from 'react';

import type { HotkeyBindingDef } from '../HotkeysManager';

type Props = {
  onDeleteRender: () => void;
};

export const hotkeyBindings: HotkeyBindingDef = {
  keys: 'x x b b a y a y ArrowDown ArrowLeft',
  category: 'modifier',
};

const SwitchToMirrorMode = ({ onDeleteRender }: Props): null => {
  useEffect(() => {
    document.body.classList.add('mirror');
    onDeleteRender();
  }, [onDeleteRender]);

  return null;
};

export { SwitchToMirrorMode };
