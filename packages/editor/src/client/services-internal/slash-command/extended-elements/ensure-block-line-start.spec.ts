// @vitest-environment jsdom
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';

import { ensureBlockLineStart } from './ensure-block-line-start.js';

const createView = (doc: string, from: number): EditorView => {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.create([EditorSelection.cursor(from)]),
  });
  return new EditorView({ state });
};

/**
 * The contract: after normalization the cursor sits at the start of a line whose
 * previous line is blank, so a block inserted at the cursor is separated from any
 * preceding paragraph by a blank line (required for a GFM table to render).
 */
const expectSeparatedFromParagraph = (view: EditorView): void => {
  const { head } = view.state.selection.main;
  const cursorLine = view.state.doc.lineAt(head);
  expect(head).toBe(cursorLine.from); // cursor at line start
  const prevLine = view.state.doc.line(cursorLine.number - 1);
  expect(prevLine.text).toBe(''); // blank line precedes the insertion point
};

describe('ensureBlockLineStart', () => {
  it('leaves the document untouched at line start', () => {
    const view = createView('foo\n', 4); // start of the empty second line

    ensureBlockLineStart(view, 4);

    expect(view.state.doc.toString()).toBe('foo\n');
    expect(view.state.selection.main.head).toBe(4);
  });

  it('treats a whitespace-only prefix as line start', () => {
    const view = createView('  ', 2);

    ensureBlockLineStart(view, 2);

    expect(view.state.doc.toString()).toBe('  ');
    expect(view.state.selection.main.head).toBe(2);
  });

  it('mid-line: inserts a BLANK line so the following block is separated from the paragraph', () => {
    const view = createView('図: ', 3); // preceding non-whitespace text

    ensureBlockLineStart(view, 3);

    // a single '\n' would leave the block absorbed into the paragraph (rendered as
    // literal text); a blank line is required
    expect(view.state.doc.toString()).toBe('図: \n\n');
    expect(view.state.selection.main.head).toBe(5);
    expectSeparatedFromParagraph(view);
  });

  it('normalizes right after a bare slash trigger position (foo/)', () => {
    const view = createView('foo/', 4);

    ensureBlockLineStart(view, 4);

    expect(view.state.doc.toString()).toBe('foo/\n\n');
    expect(view.state.selection.main.head).toBe(6);
    expectSeparatedFromParagraph(view);
  });
});
