import { EditorSelection } from '@codemirror/state';
import type { Extension, ChangeSpec, SelectionRange } from '@codemirror/state';
import type { Command } from '@codemirror/view';
import { EditorView } from '@codemirror/view';

const makeTextCodeBlock: Command = (view: EditorView) => {
  const state = view.state;
  const doc = state.doc;
  const changes: ChangeSpec[] = [];
  const newSelections: SelectionRange[] = [];

  state.selection.ranges.forEach((range) => {
    const startLine = doc.lineAt(range.from);
    const endLine = doc.lineAt(range.to);
    const selectedText = doc.sliceString(range.from, range.to, '');
    const isAlreadyWrapped = selectedText.startsWith('```') && selectedText.endsWith('```');

    const codeBlockMarkerLength = 4;

    if (isAlreadyWrapped) {
      const startMarkerEnd = startLine.from + codeBlockMarkerLength;
      const endMarkerStart = endLine.to - codeBlockMarkerLength;

      changes.push({
        from: startLine.from,
        to: startMarkerEnd,
        insert: '',
      });

      changes.push({
        from: endMarkerStart,
        to: endLine.to,
        insert: '',
      });

      newSelections.push(EditorSelection.range(startLine.from, endMarkerStart - codeBlockMarkerLength));
    }
    else {
      // Add code block markers
      changes.push({
        from: startLine.from,
        insert: '```\n',
      });

      changes.push({
        from: endLine.to,
        insert: '\n```',
      });

      if (selectedText.length === 0) {
        newSelections.push(EditorSelection.cursor(startLine.from + codeBlockMarkerLength));
      }
      else {
        newSelections.push(EditorSelection.range(startLine.from, endLine.to + codeBlockMarkerLength * 2));
      }
    }
  });

  view.dispatch({
    changes,
    selection: EditorSelection.create(newSelections),
  });

  return true;
};

const makeCodeBlockExtension: Extension = EditorView.domEventHandlers({
  keydown: (event, view) => {

    const isModKey = event.ctrlKey || event.metaKey;

    if (event.code === 'KeyC' && event.shiftKey && event.altKey && isModKey) {
      event.preventDefault();
      makeTextCodeBlock(view);
      return true;
    }

    return false;
  },
});

export const useMakeCodeBlockExtension = (): Extension => {
  return makeCodeBlockExtension;
};
