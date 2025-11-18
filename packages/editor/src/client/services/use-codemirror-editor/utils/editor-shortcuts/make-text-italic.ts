import type { EditorView, KeyBinding } from '@codemirror/view';

import { useInsertMarkdownElements } from '../insert-markdown-elements';
import { generateAddMarkdownSymbolCommand } from './generate-add-markdown-symbol-command';

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
