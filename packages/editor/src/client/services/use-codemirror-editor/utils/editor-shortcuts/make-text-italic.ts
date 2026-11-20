import type { EditorView, KeyBinding } from '@codemirror/view';

import { useInsertMarkdownElements } from '../insert-markdown-elements.js';
import { generateAddMarkdownSymbolCommand } from './generate-add-markdown-symbol-command.js';

export const useMakeTextItalicKeyBinding = (view?: EditorView): KeyBinding => {
  const insertMarkdownElements = useInsertMarkdownElements(view);

  const makeTextItalicCommand = generateAddMarkdownSymbolCommand(
    insertMarkdownElements,
    '*',
    '*',
  );

  const makeTextItalicKeyBinding = {
    key: 'mod-shift-i',
    run: makeTextItalicCommand,
  };

  return makeTextItalicKeyBinding;
};
