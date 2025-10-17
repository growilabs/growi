import { foldEffect } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import { useEffect } from 'react';

export type FoldDrawio = void;

const findAllDrawioSection = (view?: EditorView) => {
  if (view == null) {
    return;
  }

  try {
    const lineBeginPartOfDrawioRE = /^```(\s.*)drawio$/;
    const lineNumbers: number[] = [];
    // repeat the process in each line from the top to the bottom in the editor
    for (let i = 1, e = view.state.doc.lines; i <= e; i++) {
      // get each line text
      const lineTxt = view.state.doc.line(i).text;
      const match = lineBeginPartOfDrawioRE.exec(lineTxt);
      if (match) {
        lineNumbers.push(i);
      }
    }
    return lineNumbers;
  } catch (err) {
    if (err instanceof Error) {
      // eslint-disable-next-line no-console
      console.warn(err.toString());
    }
  }
};

const foldDrawioSection = (lineNumbers?: number[], view?: EditorView) => {
  if (view == null || lineNumbers == null) {
    return;
  }

  try {
    lineNumbers.forEach((lineNumber) => {
      // get the end of the lines containing '''drawio
      const from = view.state.doc.line(lineNumber).to;
      // get the end of the lines containing '''
      const to = view.state.doc.line(lineNumber + 2).to;
      view?.dispatch({
        effects: foldEffect.of({
          from,
          to,
        }),
      });
    });
  } catch (err) {
    if (err instanceof Error) {
      // eslint-disable-next-line no-console
      console.warn(err.toString());
    }
  }
};

export const useFoldDrawio = (view?: EditorView): FoldDrawio => {
  const lineNumbers = findAllDrawioSection(view);

  useEffect(() => {
    foldDrawioSection(lineNumbers, view);
  }, [view, lineNumbers]);
};
