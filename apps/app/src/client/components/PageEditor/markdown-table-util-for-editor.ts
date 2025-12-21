import type { EditorView } from '@growi/editor';
import { MarkdownTable } from '@growi/editor';

// https://regex101.com/r/7BN2fR/10
const linePartOfTableRE = /^([^\r\n|]*)\|(([^\r\n|]*\|)+)$/;
// https://regex101.com/r/1UuWBJ/3
export const emptyLineOfTableRE = /^([^\r\n|]*)\|((\s*\|)+)$/;

const curPos = (editor: EditorView): number => {
  return editor.state.selection.main.head;
};

/**
 * return boolean value whether the cursor position is in a table
 */
export const isInTable = (editor: EditorView): boolean => {
  const lineText = editor.state.doc.lineAt(curPos(editor)).text;
  return linePartOfTableRE.test(lineText);
};

/**
 * return the postion of the BOT(beginning of table)
 * (If the cursor is not in a table, return its position)
 */
const getBot = (editor: EditorView): number => {
  if (!isInTable(editor)) {
    return curPos(editor);
  }

  const doc = editor.state.doc;
  const firstLine = 1;
  let line = doc.lineAt(curPos(editor)).number - 1;
  for (; line >= firstLine; line--) {
    const strLine = doc.line(line).text;
    if (!linePartOfTableRE.test(strLine)) {
      break;
    }
  }
  const botLine = Math.max(firstLine, line + 1);
  return doc.line(botLine).from;
};

/**
 * return the postion of the EOT(end of table)
 * (If the cursor is not in a table, return its position)
 */
const getEot = (editor: EditorView): number => {
  if (!isInTable(editor)) {
    return curPos(editor);
  }

  const doc = editor.state.doc;
  const lastLine = doc.lines;
  let line = doc.lineAt(curPos(editor)).number + 1;
  for (; line <= lastLine; line++) {
    const strLine = doc.line(line).text;
    if (!linePartOfTableRE.test(strLine)) {
      break;
    }
  }
  const eotLine = Math.min(line - 1, lastLine);
  return doc.line(eotLine).to;
};

/**
 * return strings from BOT(beginning of table) to the cursor position
 */
export const getStrFromBot = (editor: EditorView): string => {
  return editor.state.sliceDoc(getBot(editor), curPos(editor));
};

/**
 * return strings from the cursor position to EOT(end of table)
 */
export const getStrToEot = (editor: EditorView): string => {
  return editor.state.sliceDoc(curPos(editor), getEot(editor));
};

/**
 * return MarkdownTable instance of the table where the cursor is
 * (If the cursor is not in a table, return null)
 */
export const getMarkdownTable = (
  editor: EditorView,
): MarkdownTable | undefined => {
  if (!isInTable(editor)) {
    return;
  }

  const strFromBotToEot = editor.state.sliceDoc(getBot(editor), getEot(editor));
  return MarkdownTable.fromMarkdownString(strFromBotToEot);
};

/**
 * return boolean value whether the cursor position is end of line
 */
export const isEndOfLine = (editor: EditorView): boolean => {
  return curPos(editor) === editor.state.doc.lineAt(curPos(editor)).to;
};

/**
 * add a row at the end
 * (This function overwrite directory markdown table specified as argument.)
 */
export const addRowToMarkdownTable = (mdtable: MarkdownTable): any => {
  const numCol = mdtable.table.length > 0 ? mdtable.table[0].length : 1;
  const newRow: string[] = [];
  new Array(numCol).forEach(() => {
    return newRow.push('');
  }); // create cols
  mdtable.table.push(newRow);
};

/**
 * return markdown table that is merged all of markdown table in array
 * (The merged markdown table options are used for the first markdown table.)
 */
export const mergeMarkdownTable = (
  mdtableList: MarkdownTable,
): MarkdownTable | undefined => {
  if (mdtableList == null || !(mdtableList instanceof Array)) {
    return undefined;
  }

  let newTable = [];
  const options = mdtableList[0].options; // use option of first markdown-table
  mdtableList.forEach((mdtable) => {
    newTable = newTable.concat(mdtable.table);
  });
  return new MarkdownTable(newTable, options);
};

/**
 * replace focused markdown table with editor
 * (A replaced table is reformed by markdown-table.)
 */
export const replaceFocusedMarkdownTableWithEditor = (
  editor: EditorView,
  table: MarkdownTable,
): void => {
  const botPos = getBot(editor);
  const eotPos = getEot(editor);

  editor.dispatch({
    changes: {
      from: botPos,
      to: eotPos,
      insert: table.toString(),
    },
  });
  editor.dispatch({
    selection: { anchor: editor.state.doc.lineAt(curPos(editor)).to },
  });
  editor.focus();
};
