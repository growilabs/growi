import { Prec } from '@codemirror/state';

import type { KeymapFactory } from './types';

let initialized = false;

export const vimKeymap: KeymapFactory = async (onSave) => {
  const { Vim, vim } = await import('@replit/codemirror-vim');

  if (!initialized) {
    Vim.map('jj', '<Esc>', 'insert');
    Vim.map('jk', '<Esc>', 'insert');
    initialized = true;
  }

  if (onSave != null) {
    Vim.defineEx('write', 'w', onSave);
  }

  return {
    extension: vim(),
    precedence: Prec.high,
    overrides: [],
  };
};
