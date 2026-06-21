import { Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';

import type { KeymapFactory } from './types';

export const defaultKeymap: KeymapFactory = async () => {
  const { defaultKeymap: cmDefaultKeymap } = await import(
    '@codemirror/commands'
  );
  return {
    extension: keymap.of(cmDefaultKeymap),
    precedence: Prec.low,
    overrides: [],
  };
};
