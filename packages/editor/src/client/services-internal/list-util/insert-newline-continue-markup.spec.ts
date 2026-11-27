import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { insertNewlineContinueMarkup } from './insert-newline-continue-markup.js';

const createView = (
  doc: string,
  ranges: readonly { anchor: number; head?: number }[],
): EditorView => {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.create(
      ranges.map(({ anchor, head }) =>
        EditorSelection.range(anchor, head ?? anchor),
      ),
    ),
    extensions: [EditorState.allowMultipleSelections.of(true)],
  });
  return new EditorView({ state });
};

const cursorPositions = (view: EditorView): number[] =>
  view.state.selection.ranges.map((r) => {
    expect(r.empty).toBe(true);
    return r.head;
  });

describe('insertNewlineContinueMarkup', () => {
  describe('with a collapsed cursor', () => {
    it('inserts a line break in plain text', () => {
      const view = createView('hello world', [{ anchor: 5 }]);

      insertNewlineContinueMarkup(view);

      expect(view.state.doc.toString()).toBe('hello\n world');
      expect(cursorPositions(view)).toEqual([6]);
    });

    it('continues the list markup', () => {
      const view = createView('- foo', [{ anchor: 5 }]);

      insertNewlineContinueMarkup(view);

      expect(view.state.doc.toString()).toBe('- foo\n- ');
      expect(cursorPositions(view)).toEqual([8]);
    });

    it('clears a markup-only line', () => {
      const view = createView('- foo\n- ', [{ anchor: 8 }]);

      insertNewlineContinueMarkup(view);

      expect(view.state.doc.toString()).toBe('- foo\n\n');
      expect(cursorPositions(view)).toEqual([7]);
    });
  });

  describe('with a non-empty selection', () => {
    it('replaces the selected plain text with a line break', () => {
      const view = createView('hello world', [{ anchor: 2, head: 9 }]);

      insertNewlineContinueMarkup(view);

      expect(view.state.doc.toString()).toBe('he\nld');
      expect(cursorPositions(view)).toEqual([3]);
    });

    it('replaces a backward selection the same way', () => {
      const view = createView('hello world', [{ anchor: 9, head: 2 }]);

      insertNewlineContinueMarkup(view);

      expect(view.state.doc.toString()).toBe('he\nld');
      expect(cursorPositions(view)).toEqual([3]);
    });

    it('replaces a selection spanning lines', () => {
      const view = createView('abc\ndef', [{ anchor: 1, head: 6 }]);

      insertNewlineContinueMarkup(view);

      expect(view.state.doc.toString()).toBe('a\nf');
      expect(cursorPositions(view)).toEqual([2]);
    });

    it('replaces the selection inside a list item and continues the markup', () => {
      const view = createView('- foo bar', [{ anchor: 6, head: 9 }]);

      insertNewlineContinueMarkup(view);

      expect(view.state.doc.toString()).toBe('- foo \n- ');
      expect(cursorPositions(view)).toEqual([9]);
    });

    it('replaces every selected range', () => {
      const view = createView('aaa bbb', [
        { anchor: 0, head: 1 },
        { anchor: 4, head: 5 },
      ]);

      insertNewlineContinueMarkup(view);

      expect(view.state.doc.toString()).toBe('\naa \nbb');
      expect(cursorPositions(view)).toEqual([1, 5]);
    });
  });
});
