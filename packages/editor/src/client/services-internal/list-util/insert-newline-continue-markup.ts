import type { ChangeSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

// https://regex101.com/r/r9plEA/1
const indentAndMarkRE =
  /^(\s*)(>[> ]*|[*+-] \[[x ]\]\s|[*+-]\s|(\d+)([.)]\s))(\s*)/;
// https://regex101.com/r/HFYoFN/1
const indentAndMarkOnlyRE =
  /^(\s*)(>[> ]*|[*+-] \[[x ]\]|[*+-]|(\d+)[.)])(\s*)$/;

export const insertNewlineContinueMarkup = (editor: EditorView): void => {
  const changes: ChangeSpec[] = [];

  let selection:
    | typeof editor.state.selection
    | {
        anchor: number;
        head?: number;
      }
    | undefined;

  const curPos = editor.state.selection.main.head;

  const aboveLine = editor.state.doc.lineAt(curPos).number;
  const bolPos = editor.state.doc.line(aboveLine).from;

  const strFromBol = editor.state.sliceDoc(bolPos, curPos);

  // If the text before the cursor is only markdown symbols
  if (indentAndMarkOnlyRE.test(strFromBol)) {
    const insert = editor.state.lineBreak;

    changes.push({
      from: bolPos,
      to: curPos,
      insert,
    });
  }

  // If the text before the cursor is markdown text
  else if (indentAndMarkRE.test(strFromBol)) {
    const indentAndMark = strFromBol.match(indentAndMarkRE)?.[0];

    if (indentAndMark == null) {
      return;
    }

    const insert = editor.state.lineBreak + indentAndMark;
    const nextCurPos = curPos + insert.length;

    selection = { anchor: nextCurPos };

    changes.push({
      from: curPos,
      insert,
    });
  }

  // If the text before the cursor is regular text
  else {
    const insert = editor.state.lineBreak;
    const nextCurPos = curPos + insert.length;

    selection = { anchor: nextCurPos };

    changes.push({
      from: curPos,
      insert,
    });
  }

  editor.dispatch({
    changes,
    selection,
    userEvent: 'input',
  });
};
