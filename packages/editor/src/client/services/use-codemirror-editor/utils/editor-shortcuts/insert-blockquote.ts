import type { EditorView, KeyBinding } from '@codemirror/view';

import { useInsertPrefix } from '../insert-prefix';

import { generateAddMarkdownSymbolCommand } from './generate-add-markdown-symbol-command';


export const useInsertBlockquoteKeyBinding = (view?: EditorView): KeyBinding => {

  const insertPrefix = useInsertPrefix(view);

  const insertBlockquoteCommand = generateAddMarkdownSymbolCommand(insertPrefix, '>');

  const insertBlockquoteKeyBinding = { key: 'mod-shift-9', run: insertBlockquoteCommand };

  return insertBlockquoteKeyBinding;
};
