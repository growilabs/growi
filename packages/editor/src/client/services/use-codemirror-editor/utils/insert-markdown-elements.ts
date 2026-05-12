import { useCallback } from 'react';
import type { EditorView } from '@codemirror/view';

import { toggleMarkdownSymbol } from '../../../services-internal/markdown-utils';

export type InsertMarkdownElements = (prefix: string, suffix: string) => void;

export const useInsertMarkdownElements = (
  view?: EditorView,
): InsertMarkdownElements => {
  return useCallback(
    (prefix, suffix) => {
      if (view == null) return;
      toggleMarkdownSymbol(view, prefix, suffix);
    },
    [view],
  );
};
