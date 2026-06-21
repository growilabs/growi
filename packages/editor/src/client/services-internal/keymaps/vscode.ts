import { Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';

import type { KeymapFactory } from './types';

export const vscodeKeymap: KeymapFactory = async () => {
  const { vscodeKeymap: cmVscodeKeymap } = await import(
    '@replit/codemirror-vscode-keymap'
  );
  return {
    extension: keymap.of(cmVscodeKeymap),
    precedence: Prec.low,
    overrides: [],
  };
};
