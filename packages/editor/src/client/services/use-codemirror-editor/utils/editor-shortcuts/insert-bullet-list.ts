import type { EditorView, KeyBinding } from '@codemirror/view';

import { useInsertPrefix } from '../insert-prefix.js';
import { generateAddMarkdownSymbolCommand } from './generate-add-markdown-symbol-command.js';

export const useInsertBulletListKeyBinding = (
  view?: EditorView,
): KeyBinding => {
  const insertPrefix = useInsertPrefix(view);

  const insertBulletListCommand = generateAddMarkdownSymbolCommand(
    insertPrefix,
    '-',
  );

  const insertBulletListKeyBinding = {
    key: 'mod-shift-8',
    run: insertBulletListCommand,
  };

  return insertBulletListKeyBinding;
};
