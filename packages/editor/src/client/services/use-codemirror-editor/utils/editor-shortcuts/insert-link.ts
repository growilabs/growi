import type { EditorView, KeyBinding } from '@codemirror/view';

import { useInsertMarkdownElements } from '../insert-markdown-elements';

import { generateAddMarkdownSymbolCommand } from './generate-add-markdown-symbol-command';


export const useInsertLinkKeyBinding = (view?: EditorView): KeyBinding => {

  const insertMarkdownElements = useInsertMarkdownElements(view);

  const InsertLinkCommand = generateAddMarkdownSymbolCommand(insertMarkdownElements, '[', ']()');

  const InsertLinkKeyBinding = { key: 'mod-shift-u', run: InsertLinkCommand };

  return InsertLinkKeyBinding;
};
