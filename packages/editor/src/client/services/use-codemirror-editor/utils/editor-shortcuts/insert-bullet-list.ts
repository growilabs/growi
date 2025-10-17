import type { EditorView, KeyBinding } from '@codemirror/view';

import { useInsertPrefix } from '../insert-prefix';
import { generateAddMarkdownSymbolCommand } from './generate-add-markdown-symbol-command';

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
