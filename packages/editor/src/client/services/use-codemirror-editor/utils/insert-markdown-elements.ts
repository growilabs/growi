import { useCallback } from 'react';
import type { EditorView } from '@codemirror/view';

export type InsertMarkdownElements = (prefix: string, suffix: string) => void;

const removeSymbol = (text: string, prefix: string, suffix: string): string => {
  let result = text;

  if (result.startsWith(prefix)) {
    result = result.slice(prefix.length);
  }

  if (result.endsWith(suffix)) {
    result = result.slice(0, -suffix.length);
  }

  return result;
};

export const useInsertMarkdownElements = (
  view?: EditorView,
): InsertMarkdownElements => {
  return useCallback(
    (prefix, suffix) => {
      if (view == null) return;

      const from = view?.state.selection.main.from;
      const to = view?.state.selection.main.to;

      const selectedText = view?.state.sliceDoc(from, to);
      const cursorPos = view?.state.selection.main.head;

      let insertText: string;

      if (selectedText?.startsWith(prefix) && selectedText?.endsWith(suffix)) {
        insertText = removeSymbol(selectedText, prefix, suffix);
      } else {
        insertText = prefix + selectedText + suffix;
      }

      const selection =
        from === to
          ? { anchor: from + prefix.length }
          : { anchor: from, head: from + insertText.length };

      const transaction = view?.state.replaceSelection(insertText);

      if (transaction == null || cursorPos == null) {
        return;
      }
      view?.dispatch(transaction);
      view?.dispatch({ selection });
      view?.focus();
    },
    [view],
  );
};
