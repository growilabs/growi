import type { KeyMapMode } from '../../../consts/index.js';
import type { KeymapResult } from './types.js';

export type { KeymapFactory, KeymapResult, ShortcutCategory } from './types.js';

export const getKeymap = async (
  keyMapName?: KeyMapMode,
  onSave?: () => void,
): Promise<KeymapResult> => {
  switch (keyMapName) {
    case 'vim':
      return (await import('./vim.js')).vimKeymap(onSave);
    case 'emacs':
      return (await import('./emacs/index.js')).emacsKeymap(onSave);
    case 'vscode':
      return (await import('./vscode.js')).vscodeKeymap();
    default:
      return (await import('./default.js')).defaultKeymap();
  }
};
