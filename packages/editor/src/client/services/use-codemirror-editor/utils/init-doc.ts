import { Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { useCallback } from 'react';

export type InitDoc = (doc?: string) => void;

export const useInitDoc = (view?: EditorView): InitDoc => {
  return useCallback(
    (doc) => {
      view?.dispatch({
        changes: {
          from: 0,
          to: view?.state.doc.length,
          insert: doc,
        },
        annotations: Transaction.addToHistory.of(false),
      });
    },
    [view],
  );
};
