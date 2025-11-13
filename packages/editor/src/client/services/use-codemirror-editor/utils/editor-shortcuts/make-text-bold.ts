import type { EditorView, KeyBinding } from '@codemirror/view';

import { useInsertMarkdownElements } from '../insert-markdown-elements';

import { generateAddMarkdownSymbolCommand } from './generate-add-markdown-symbol-command';

import type { KeyMapMode } from 'src/consts';


export const useMakeTextBoldKeyBinding = (view?: EditorView, keyMapName?: KeyMapMode): KeyBinding => {

  const insertMarkdownElements = useInsertMarkdownElements(view);

  let makeTextBoldKeyBinding: KeyBinding;
  switch (keyMapName) {
    case 'vim':
      makeTextBoldKeyBinding = { key: 'mod-shift-b', run: generateAddMarkdownSymbolCommand(insertMarkdownElements, '**', '**') };
      break;
    default:
      makeTextBoldKeyBinding = { key: 'mod-b', run: generateAddMarkdownSymbolCommand(insertMarkdownElements, '**', '**') };
  }

  return makeTextBoldKeyBinding;
};
