import type { KeyMapMode } from '../../../consts';
import type { KeymapResult } from './types';

export type { KeymapFactory, KeymapResult, ShortcutCategory } from './types';

export const getKeymap = async (
  keyMapName?: KeyMapMode,
  onSave?: () => void,
): Promise<KeymapResult> => {
  switch (keyMapName) {
    case 'vim':
      return (await import('./vim')).vimKeymap(onSave);
    case 'emacs':
      return (await import('./emacs')).emacsKeymap(onSave);
    case 'vscode':
      return (await import('./vscode')).vscodeKeymap();
    default:
      return (await import('./default')).defaultKeymap();
  }
};
