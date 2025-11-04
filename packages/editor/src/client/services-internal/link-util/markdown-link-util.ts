import type { EditorView } from '@codemirror/view';

import { Linker } from '../../../models';

const curPos = (editor: EditorView) => {
  return editor.state.selection.main.head;
};

const doc = (editor: EditorView) => {
  return editor.state.doc;
};

const getCursorLine = (editor: EditorView) => {
  return doc(editor).lineAt(curPos(editor));
};

export const isInLink = (editor: EditorView): boolean => {
  const cursorLine = getCursorLine(editor);
  const startPos = curPos(editor) - cursorLine.from;

  const { beginningOfLink, endOfLink } = Linker.getBeginningAndEndIndexOfLink(
    cursorLine.text,
    startPos,
  );
  return beginningOfLink >= 0 && endOfLink >= 0;
};
export const getMarkdownLink = (editor: EditorView): Linker => {
  if (!isInLink(editor)) {
    const selection = editor?.state.sliceDoc(
      editor?.state.selection.main.from,
      editor?.state.selection.main.to,
    );
    return Linker.fromMarkdownString(selection);
  }

  const cursorLine = getCursorLine(editor);
  const startPos = curPos(editor) - cursorLine.from;
  return Linker.fromLineWithIndex(cursorLine.text, startPos);
};

export const replaceFocusedMarkdownLinkWithEditor = (
  editor: EditorView,
  linkText: string,
): void => {
  editor.dispatch(editor.state.replaceSelection(linkText));
};
