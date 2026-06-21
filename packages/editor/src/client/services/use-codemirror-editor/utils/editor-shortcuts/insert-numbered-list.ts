import type { EditorView, KeyBinding } from '@codemirror/view';

import { useInsertPrefix } from '../insert-prefix';
import { generateAddMarkdownSymbolCommand } from './generate-add-markdown-symbol-command';

export const useInsertNumberedKeyBinding = (view?: EditorView): KeyBinding => {
  const insertPrefix = useInsertPrefix(view);

  const insertNumberedCommand = generateAddMarkdownSymbolCommand(
    insertPrefix,
    '1.',
  );

  const insertNumberedKeyBinding = {
    key: 'mod-shift-7',
    run: insertNumberedCommand,
  };

  return insertNumberedKeyBinding;
};
