import type { EditorView } from '@codemirror/view';

import { MarkdownTable } from '../../../models';

// https://regex101.com/r/7BN2fR/10
const linePartOfTableRE = /^([^\r\n|]*)\|(([^\r\n|]*\|)+)$/;
// https://regex101.com/r/1UuWBJ/3
export const emptyLineOfTableRE = /^([^\r\n|]*)\|((\s*\|)+)$/;

const getCurPos = (editor: EditorView): number => {
  return editor.state.selection.main.head;
};

export const isInTable = (editor: EditorView): boolean => {
  const curPos = getCurPos(editor);
  const lineText = editor.state.doc.lineAt(curPos).text;
  return linePartOfTableRE.test(lineText);
};

const getBot = (editor: EditorView): number => {
  if (!isInTable(editor)) {
    return getCurPos(editor);
  }

  const doc = editor.state.doc;
  const firstLine = 1;
  let line = doc.lineAt(getCurPos(editor)).number - 1;
  for (; line >= firstLine; line--) {
    const strLine = doc.line(line).text;
    if (!linePartOfTableRE.test(strLine)) {
      break;
    }
  }
  const botLine = Math.max(firstLine, line + 1);
  return doc.line(botLine).from;
};

const getEot = (editor: EditorView): number => {
  if (!isInTable(editor)) {
    return getCurPos(editor);
  }

  const doc = editor.state.doc;
  const lastLine = doc.lines;

  let line = doc.lineAt(getCurPos(editor)).number + 1;

  for (; line <= lastLine; line++) {
    const strLine = doc.line(line).text;
    if (!linePartOfTableRE.test(strLine)) {
      break;
    }
  }

  const eotLine = line - 1;

  return doc.line(eotLine).to;
};

const getStrFromBot = (editor: EditorView): string => {
  return editor.state.sliceDoc(getBot(editor), getCurPos(editor));
};

const getStrToEot = (editor: EditorView): string => {
  return editor.state.sliceDoc(getCurPos(editor), getEot(editor));
};

const addRowToMarkdownTable = (mdtable: MarkdownTable): any => {
  const numCol = mdtable.table.length > 0 ? mdtable.table[0].length : 1;
  const newRow: string[] = new Array(numCol);

  newRow.fill('');

  mdtable.table.push(newRow);
};

export const mergeMarkdownTable = (
  mdtableList: MarkdownTable[],
): MarkdownTable => {
  let newTable: any[] = [];
  const options = mdtableList[0].options;
  mdtableList.forEach((mdtable) => {
    newTable = newTable.concat(mdtable.table);
  });
  return new MarkdownTable(newTable, options);
};

const addRow = (editor: EditorView) => {
  const strFromBot = getStrFromBot(editor);

  let table = MarkdownTable.fromMarkdownString(strFromBot);

  addRowToMarkdownTable(table);

  const strToEot = getStrToEot(editor);

  const tableBottom = MarkdownTable.fromMarkdownString(strToEot);

  if (tableBottom.table.length > 0) {
    table = mergeMarkdownTable([table, tableBottom]);
  }

  const curPos = getCurPos(editor);

  const curLine = editor.state.doc.lineAt(curPos).number;
  const nextLine = curLine + 1;

  const botPos = getBot(editor);
  const eotPos = getEot(editor);

  editor.dispatch({
    changes: {
      from: botPos,
      to: eotPos,
      insert: table.toString(),
    },
  });

  const nextCurPos = editor.state.doc.line(nextLine).from + 2;

  editor.dispatch({
    selection: { anchor: nextCurPos },
  });
};

const removeRow = (editor: EditorView) => {
  const curPos = getCurPos(editor);

  const curLine = editor.state.doc.lineAt(curPos).number;

  const bolPos = editor.state.doc.line(curLine).from;
  const eolPos = editor.state.doc.line(curLine).to;

  editor.dispatch({
    changes: {
      from: bolPos,
      to: eolPos,
    },
  });

  const nextCurPos = editor.state.doc.lineAt(getCurPos(editor)).to + 1;

  editor.dispatch({
    selection: { anchor: nextCurPos },
  });
};

const reformTable = (editor: EditorView) => {
  const tableStr = getStrFromBot(editor) + getStrToEot(editor);
  const table = MarkdownTable.fromMarkdownString(tableStr);

  const curPos = getCurPos(editor);
  const botPos = getBot(editor);
  const eotPos = getEot(editor);

  const curLine = editor.state.doc.lineAt(curPos).number;
  const nextLine = curLine + 1;

  const eolPos = editor.state.doc.line(curLine).to;
  const strToEol = editor.state.sliceDoc(curPos, eolPos);

  const isLastRow = getStrToEot(editor) === strToEol;

  editor.dispatch({
    changes: {
      from: botPos,
      to: eotPos,
      insert: table.toString(),
    },
  });

  const nextCurPos = isLastRow
    ? editor.state.doc.line(curLine).to
    : editor.state.doc.line(nextLine).from + 2;

  editor.dispatch({
    selection: { anchor: nextCurPos },
  });
};

export const insertNewRowToMarkdownTable = (editor: EditorView): void => {
  const curPos = getCurPos(editor);

  const curLine = editor.state.doc.lineAt(curPos).number;

  const bolPos = editor.state.doc.line(curLine).from;
  const eolPos = editor.state.doc.line(curLine).to;

  const strFromBol = editor.state.sliceDoc(bolPos, curPos);
  const strToEol = editor.state.sliceDoc(curPos, eolPos);

  const isLastRow = getStrToEot(editor) === strToEol;
  const isEndOfLine = curPos === eolPos;

  if (isEndOfLine) {
    addRow(editor);
  } else if (isLastRow && emptyLineOfTableRE.test(strFromBol + strToEol)) {
    removeRow(editor);
  } else {
    reformTable(editor);
  }
};
