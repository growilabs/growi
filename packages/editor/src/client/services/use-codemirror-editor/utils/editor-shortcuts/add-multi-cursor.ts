import { useCallback } from 'react';

import type { SelectionRange } from '@codemirror/state';
import { EditorSelection } from '@codemirror/state';
import type { EditorView, Command, KeyBinding } from '@codemirror/view';


const addMultiCursor = (view: EditorView, direction: 'up' | 'down') => {

  const selection = view.state.selection;
  const doc = view.state.doc;
  const ranges = selection.ranges;
  const newRanges: SelectionRange[] = [];

  ranges.forEach((range) => {

    const head = range.head;
    const line = doc.lineAt(head);
    const targetLine = direction === 'up' ? line.number - 1 : line.number + 1;

    if (targetLine < 1 || targetLine > doc.lines) return;

    const targetLineText = doc.line(targetLine);

    const col = Math.min(range.head - line.from, targetLineText.length);
    const cursorPos = targetLineText.from + col;

    newRanges.push(EditorSelection.cursor(cursorPos));

  });

  if (newRanges.length) {
    const transaction = {
      selection: EditorSelection.create([...ranges, ...newRanges]),
    };

    view.dispatch(transaction);
  }

  return true;
};

const useAddMultiCursorCommand = (direction: 'up' | 'down'): Command => {
  return useCallback((view?: EditorView) => {
    if (view == null) return false;
    addMultiCursor(view, direction);
    return true;
  }, [direction]);
};

export const useAddMultiCursorKeyBindings = (): KeyBinding[] => {

  const upMultiCursorCommand = useAddMultiCursorCommand('up');
  const downMultiCursorCommand = useAddMultiCursorCommand('down');

  const keyBindings = [
    { key: 'mod-alt-ArrowUp', run: upMultiCursorCommand },
    { key: 'mod-alt-ArrowDown', run: downMultiCursorCommand },
  ];

  return keyBindings;
};
