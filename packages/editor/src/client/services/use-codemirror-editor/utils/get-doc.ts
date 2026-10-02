import { useCallback } from 'react';
import { Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

export type GetDoc = () => Text;
export type GetDocString = () => string;

export const useGetDoc = (view?: EditorView): GetDoc => {
  return useCallback(() => {
    return view?.state.doc ?? Text.empty;
  }, [view]);
};

export const useGetDocString = (view?: EditorView): GetDocString => {
  return useCallback(() => {
    return (view?.state.doc ?? Text.empty).toString();
  }, [view]);
};
