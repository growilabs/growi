import { EditorSelection, type EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

// https://regex101.com/r/r9plEA/1
const indentAndMarkRE =
  /^(\s*)(>[> ]*|[*+-] \[[x ]\]\s|[*+-]\s|(\d+)([.)]\s))(\s*)/;
// https://regex101.com/r/HFYoFN/1
const indentAndMarkOnlyRE =
  /^(\s*)(>[> ]*|[*+-] \[[x ]\]|[*+-]|(\d+)[.)])(\s*)$/;

type NewlineReplacement = { readonly from: number; readonly insert: string };

const buildReplacement = (
  state: EditorState,
  from: number,
): NewlineReplacement => {
  const bolPos = state.doc.lineAt(from).from;
  const strFromBol = state.sliceDoc(bolPos, from);

  // The text before the cursor is only markdown symbols: clear them
  if (indentAndMarkOnlyRE.test(strFromBol)) {
    return { from: bolPos, insert: state.lineBreak };
  }

  // The text before the cursor is markdown text: continue the markup
  const indentAndMark = strFromBol.match(indentAndMarkRE)?.[0];
  if (indentAndMark != null) {
    return { from, insert: state.lineBreak + indentAndMark };
  }

  return { from, insert: state.lineBreak };
};

export const insertNewlineContinueMarkup = (editor: EditorView): void => {
  const { state } = editor;

  const transaction = state.changeByRange((range) => {
    const { from, insert } = buildReplacement(state, range.from);
    return {
      changes: { from, to: range.to, insert },
      range: EditorSelection.cursor(from + insert.length),
    };
  });

  editor.dispatch(transaction, { userEvent: 'input' });
};
