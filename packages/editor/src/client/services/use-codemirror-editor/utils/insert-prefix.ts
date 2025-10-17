import type { ChangeSpec, Line, Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { useCallback } from 'react';

export type InsertPrefix = (
  prefix: string,
  noSpaceIfPrefixExists?: boolean,
) => void;

// https:// regex101.com/r/5ILXUX/1
const LEADING_SPACES = /^\s*/;
// https://regex101.com/r/ScAXzy/1
const createPrefixPattern = (prefix: string) =>
  new RegExp(`^\\s*(${prefix}+)\\s*`);

const removePrefix = (text: string, prefix: string): string => {
  if (text.startsWith(prefix)) {
    return text.slice(prefix.length).trimStart();
  }
  return text;
};

const allLinesEmpty = (doc: Text, startLine: Line, endLine: Line) => {
  for (let i = startLine.number; i <= endLine.number; i++) {
    const line = doc.line(i);
    if (line.text.trim() !== '') {
      return false;
    }
  }
  return true;
};

const allLinesHavePrefix = (
  doc: Text,
  startLine: Line,
  endLine: Line,
  prefix: string,
) => {
  let hasNonEmptyLine = false;

  for (let i = startLine.number; i <= endLine.number; i++) {
    const line = doc.line(i);
    const trimmedLine = line.text.trim();

    if (trimmedLine !== '') {
      hasNonEmptyLine = true;
      if (!trimmedLine.startsWith(prefix)) {
        return false;
      }
    }
  }

  return hasNonEmptyLine;
};

export const useInsertPrefix = (view?: EditorView): InsertPrefix => {
  return useCallback(
    (prefix: string, noSpaceIfPrefixExists = false) => {
      if (view == null) {
        return;
      }

      const { from, to } = view.state.selection.main;
      const doc = view.state.doc;
      const startLine = doc.lineAt(from);
      const endLine = doc.lineAt(to);

      const changes: ChangeSpec[] = [];
      let totalLengthChange = 0;

      const isPrefixRemoval = allLinesHavePrefix(
        doc,
        startLine,
        endLine,
        prefix,
      );

      if (allLinesEmpty(doc, startLine, endLine)) {
        for (let i = startLine.number; i <= endLine.number; i++) {
          const line = view.state.doc.line(i);
          const leadingSpaces = line.text.match(LEADING_SPACES)?.[0] || '';
          const insertText = `${leadingSpaces}${prefix} `;

          const change = {
            from: line.from,
            to: line.to,
            insert: insertText,
          };

          changes.push(change);
          totalLengthChange += insertText.length - (line.to - line.from);
        }

        view.dispatch({ changes });
        view.dispatch({
          selection: {
            anchor: from + totalLengthChange,
            head: to + totalLengthChange,
          },
        });
        view.focus();
        return;
      }

      for (let i = startLine.number; i <= endLine.number; i++) {
        const line = view.state.doc.line(i);
        const trimmedLine = line.text.trim();
        const leadingSpaces = line.text.match(LEADING_SPACES)?.[0] || '';
        const contentTrimmed = line.text.trimStart();

        if (trimmedLine === '') {
          continue;
        }

        let newLine = '';
        let lengthChange = 0;

        if (isPrefixRemoval) {
          const prefixPattern = createPrefixPattern(prefix);
          const contentStartMatch = line.text.match(prefixPattern);

          if (contentStartMatch) {
            if (noSpaceIfPrefixExists) {
              const existingPrefixes = contentStartMatch[1];
              const indentLevel = Math.floor(leadingSpaces.length / 2) * 2;
              const newIndent = ' '.repeat(indentLevel);
              newLine = `${newIndent}${existingPrefixes}${prefix} ${line.text.slice(contentStartMatch[0].length)}`;
            } else {
              const indentLevel = Math.floor(leadingSpaces.length / 2) * 2;
              const newIndent = ' '.repeat(indentLevel);
              const prefixRemovedText = removePrefix(contentTrimmed, prefix);
              newLine = `${newIndent}${prefixRemovedText}`;
            }

            lengthChange = newLine.length - (line.to - line.from);

            changes.push({
              from: line.from,
              to: line.to,
              insert: newLine,
            });
          }
        } else {
          if (noSpaceIfPrefixExists && contentTrimmed.startsWith(prefix)) {
            newLine = `${leadingSpaces}${prefix}${contentTrimmed}`;
          } else {
            newLine = `${leadingSpaces}${prefix} ${contentTrimmed}`;
          }

          lengthChange = newLine.length - (line.to - line.from);

          changes.push({
            from: line.from,
            to: line.to,
            insert: newLine,
          });
        }

        totalLengthChange += lengthChange;
      }

      if (changes.length > 0) {
        view.dispatch({ changes });

        view.dispatch({
          selection: {
            anchor: from,
            head: to + totalLengthChange,
          },
        });
        view.focus();
      }
    },
    [view],
  );
};
