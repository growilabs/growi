import type { EditorView } from '@codemirror/view';
import { useCallback } from 'react';

export type Focus = () => void;

export const useFocus = (view?: EditorView): Focus => {
  return useCallback(() => {
    view?.focus?.();
  }, [view]);
};
