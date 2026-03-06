import type { EditorView } from '@growi/editor';

const lineBeginPartOfDrawioRE = /^```(\s.*)drawio$/;
const lineEndPartOfDrawioRE = /^```$/;
const firstLineNum = 1;

const curPos = (editor: EditorView) => {
  return editor.state.selection.main.head;
};

const doc = (editor: EditorView) => {
  return editor.state.doc;
};

const lastLineNum = (editor: EditorView) => {
  return doc(editor).lines;
};

const getCursorLine = (editor: EditorView) => {
  return doc(editor).lineAt(curPos(editor));
};

const getLine = (editor: EditorView, lineNum: number) => {
  return doc(editor).line(lineNum);
};

/**
 * return the postion of the BOD(beginning of drawio)
 * (If the BOD is not found after the cursor or the EOD is found before the BOD, return null)
 */
const getBod = (editor: EditorView) => {
  const strLine = getCursorLine(editor).text;
  if (lineBeginPartOfDrawioRE.test(strLine)) {
    // get the beginning of the line where the cursor is located
    return getCursorLine(editor).from;
  }

  let line = getCursorLine(editor).number - 1;
  let isFound = false;
  for (; line >= firstLineNum; line--) {
    const strLine = getLine(editor, line).text;
    if (lineBeginPartOfDrawioRE.test(strLine)) {
      isFound = true;
      break;
    }

    if (lineEndPartOfDrawioRE.test(strLine)) {
      isFound = false;
      break;
    }
  }

  if (!isFound) {
    return null;
  }

  const botLine = Math.max(firstLineNum, line);
  return getLine(editor, botLine).from;
};

/**
 * return the postion of the EOD(end of drawio)
 * (If the EOD is not found after the cursor or the BOD is found before the EOD, return null)
 */
const getEod = (editor: EditorView) => {
  const lastLine = lastLineNum(editor);

  const strLine = getCursorLine(editor).text;
  if (lineEndPartOfDrawioRE.test(strLine)) {
    // get the end of the line where the cursor is located
    return getCursorLine(editor).to;
  }

  let line = getCursorLine(editor).number + 1;
  let isFound = false;
  for (; line <= lastLine; line++) {
    const strLine = getLine(editor, line).text;
    if (lineEndPartOfDrawioRE.test(strLine)) {
      isFound = true;
      break;
    }

    if (lineBeginPartOfDrawioRE.test(strLine)) {
      isFound = false;
      break;
    }
  }

  if (!isFound) {
    return null;
  }

  const eodLine = Math.min(line, lastLine);
  return getLine(editor, eodLine).to;
};

/**
 * return drawioData instance where the cursor is
 * (If the cursor is not in a drawio block, return null)
 */
export const getMarkdownDrawioMxfile = (editor: EditorView): string | null => {
  const bod = getBod(editor);
  const eod = getEod(editor);
  if (
    bod == null ||
    eod == null ||
    JSON.stringify(bod) === JSON.stringify(eod)
  ) {
    return null;
  }

  // skip block begin sesion("``` drawio")
  const bodLineNum = doc(editor).lineAt(bod).number + 1;
  const bodLine = getLine(editor, bodLineNum).from;
  // skip block end sesion("```")
  const eodLineNum = doc(editor).lineAt(eod).number - 1;
  const eodLine = getLine(editor, eodLineNum).to;

  return editor.state.sliceDoc(bodLine, eodLine);
};

export const replaceFocusedDrawioWithEditor = (
  editor: EditorView,
  drawioData: string,
): void => {
  const drawioBlock = ['``` drawio', drawioData.toString(), '```'].join('\n');
  let bod = getBod(editor);
  let eod = getEod(editor);
  if (
    bod == null ||
    eod == null ||
    JSON.stringify(bod) === JSON.stringify(eod)
  ) {
    bod = curPos(editor);
    eod = curPos(editor);
  }

  editor.dispatch({
    changes: {
      from: bod,
      to: eod,
      insert: drawioBlock,
    },
  });
};
