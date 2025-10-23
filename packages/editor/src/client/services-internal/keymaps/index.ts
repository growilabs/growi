import type { Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';

import type { KeyMapMode } from '../../../consts';

export const getKeymap = async (
  keyMapName?: KeyMapMode,
  onSave?: () => void,
): Promise<Extension> => {
  switch (keyMapName) {
    case 'vim':
      return (await import('./vim')).vimKeymap(onSave);
    case 'emacs':
      return (await import('@replit/codemirror-emacs')).emacs();
    case 'vscode':
      return keymap.of(
        (await import('@replit/codemirror-vscode-keymap')).vscodeKeymap,
      );
  }
  return keymap.of((await import('@codemirror/commands')).defaultKeymap);
};
