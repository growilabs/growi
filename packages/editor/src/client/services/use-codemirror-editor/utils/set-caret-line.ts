import { Compartment, StateEffect } from '@codemirror/state';
import type { ViewUpdate } from '@codemirror/view';
import { EditorView } from '@codemirror/view';
import { useCallback } from 'react';

export type SetCaretLine = (lineNumber?: number, schedule?: boolean) => void;

const setCaretLine = (view?: EditorView, lineNumber?: number): void => {
  const doc = view?.state.doc;

  if (doc == null) {
    return;
  }

  try {
    const posOfLineEnd = doc.line(lineNumber ?? 1).to;
    view?.dispatch({
      selection: {
        anchor: posOfLineEnd,
        head: posOfLineEnd,
      },
      scrollIntoView: true,
      effects: EditorView.scrollIntoView(posOfLineEnd, {
        x: 'end',
        y: 'center',
      }),
    });
    // focus
    view?.focus();
  } catch (_: unknown) {
    // if posOfLineEnd is not found.
  }
};

const setCaretLineScheduleForYjs = (
  view?: EditorView,
  lineNumber?: number,
): void => {
  const compartment = new Compartment();

  const setCaretLineOnceExtension = EditorView.updateListener.of(
    (v: ViewUpdate) => {
      // TODO: use ySyncAnnotation for if statement and remove "currentPageYjsData?.hasRevisionBodyDiff === false" in Header.tsx
      // Ref: https://github.com/yjs/y-codemirror.next/pull/30
      if (v.docChanged && v.changes.desc.length === 0) {
        setCaretLine(view, lineNumber);

        // setCaretLineOnceExtension, which setCaretLineScheduleForYjs added, will remove itself from view.
        view?.dispatch({
          effects: compartment.reconfigure([]),
        });
      }
    },
  );

  view?.dispatch({
    effects: StateEffect.appendConfig.of(
      compartment.of(setCaretLineOnceExtension),
    ),
  });
};

export const useSetCaretLine = (view?: EditorView): SetCaretLine => {
  return useCallback(
    (lineNumber?: number, schedule?: boolean) => {
      if (schedule) {
        setCaretLineScheduleForYjs(view, lineNumber);
      } else {
        setCaretLine(view, lineNumber);
      }
    },
    [view],
  );
};
