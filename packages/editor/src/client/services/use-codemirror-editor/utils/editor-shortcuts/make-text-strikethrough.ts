import type { EditorView, KeyBinding } from '@codemirror/view';

import { useInsertMarkdownElements } from '../insert-markdown-elements.js';
import { generateAddMarkdownSymbolCommand } from './generate-add-markdown-symbol-command.js';

export const useMakeTextStrikethroughKeyBinding = (
  view?: EditorView,
): KeyBinding => {
  const insertMarkdownElements = useInsertMarkdownElements(view);

  const makeTextStrikethroughCommand = generateAddMarkdownSymbolCommand(
    insertMarkdownElements,
    '~~',
    '~~',
  );

  const makeTextStrikethroughKeyBinding = {
    key: 'mod-shift-x',
    run: makeTextStrikethroughCommand,
  };

  return makeTextStrikethroughKeyBinding;
};
