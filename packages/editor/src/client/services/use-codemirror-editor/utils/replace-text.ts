import type { EditorView } from '@codemirror/view';
import { useCallback } from 'react';

export type ReplaceText = (text: string) => void;

export const useReplaceText = (view?: EditorView): ReplaceText => {
  return useCallback(
    (text) => {
      view?.dispatch(view?.state.replaceSelection(text));
    },
    [view],
  );
};
