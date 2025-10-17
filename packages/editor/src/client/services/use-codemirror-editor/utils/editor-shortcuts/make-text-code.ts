import type { EditorView, KeyBinding } from '@codemirror/view';

import { useInsertMarkdownElements } from '../insert-markdown-elements';

import { generateAddMarkdownSymbolCommand } from './generate-add-markdown-symbol-command';


export const useMakeTextCodeKeyBinding = (view?: EditorView): KeyBinding => {

  const insertMarkdownElements = useInsertMarkdownElements(view);

  const makeTextCodeCommand = generateAddMarkdownSymbolCommand(insertMarkdownElements, '`', '`');

  const makeTextCodeKeyBinding = { key: 'mod-shift-c', run: makeTextCodeCommand };

  return makeTextCodeKeyBinding;
};
