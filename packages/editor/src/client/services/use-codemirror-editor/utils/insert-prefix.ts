import { useCallback } from 'react';
import type { EditorView } from '@codemirror/view';

import { insertLinePrefix } from '../../../services-internal/markdown-utils';

export type InsertPrefix = (
  prefix: string,
  noSpaceIfPrefixExists?: boolean,
) => void;

export const useInsertPrefix = (view?: EditorView): InsertPrefix => {
  return useCallback(
    (prefix: string, noSpaceIfPrefixExists = false) => {
      if (view == null) return;
      insertLinePrefix(view, prefix, noSpaceIfPrefixExists);
    },
    [view],
  );
};
