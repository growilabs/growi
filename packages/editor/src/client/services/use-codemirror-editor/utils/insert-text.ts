import type { EditorView } from '@codemirror/view';
import { useCallback } from 'react';

export type InsertText = (text: string) => void;

export const useInsertText = (view?: EditorView): InsertText => {
  return useCallback(
    (text) => {
      if (view == null) {
        return;
      }
      const insertPos = view.state.selection.main.head;
      view.dispatch({
        changes: {
          from: insertPos,
          to: insertPos,
          insert: text,
        },
        selection: { anchor: insertPos },
      });
    },
    [view],
  );
};
