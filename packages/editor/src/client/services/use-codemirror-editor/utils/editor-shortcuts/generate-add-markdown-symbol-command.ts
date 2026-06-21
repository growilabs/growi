import type { Command } from '@codemirror/view';

import type { InsertMarkdownElements } from '../insert-markdown-elements';
import type { InsertPrefix } from '../insert-prefix';

export const generateAddMarkdownSymbolCommand = (
  insertMarkdown: InsertMarkdownElements | InsertPrefix,
  prefix: string,
  suffix?: string,
): Command => {
  const isInsertMarkdownElements = (
    fn: InsertMarkdownElements | InsertPrefix,
  ): fn is InsertMarkdownElements => {
    return fn.length === 2;
  };

  const addMarkdownSymbolCommand: Command = () => {
    if (isInsertMarkdownElements(insertMarkdown)) {
      if (suffix == null) return false;
      insertMarkdown(prefix, suffix);
    } else {
      insertMarkdown(prefix);
    }

    return true;
  };

  return addMarkdownSymbolCommand;
};
