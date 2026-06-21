// @vitest-environment jsdom
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';

import { insertLinePrefix } from './insert-line-prefix';

const createView = (doc: string, anchor: number, head?: number): EditorView => {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.create([
      EditorSelection.range(anchor, head ?? anchor),
    ]),
  });
  return new EditorView({ state });
};

describe('insertLinePrefix', () => {
  it('should add prefix to a single line', () => {
    const view = createView('hello', 0, 5);
    insertLinePrefix(view, '>');
    expect(view.state.doc.toString()).toBe('> hello');
  });

  it('should add prefix to an empty line', () => {
    const view = createView('', 0);
    insertLinePrefix(view, '>');
    expect(view.state.doc.toString()).toBe('> ');
  });

  it('should add prefix to multiple lines', () => {
    const doc = 'line one\nline two\nline three';
    const view = createView(doc, 0, doc.length);
    insertLinePrefix(view, '>');
    expect(view.state.doc.toString()).toBe(
      '> line one\n> line two\n> line three',
    );
  });

  it('should remove prefix when all non-empty lines already have it', () => {
    const doc = '> line one\n> line two';
    const view = createView(doc, 0, doc.length);
    insertLinePrefix(view, '>');
    expect(view.state.doc.toString()).toBe('line one\nline two');
  });

  it('should skip empty lines when adding prefix', () => {
    const doc = 'line one\n\nline three';
    const view = createView(doc, 0, doc.length);
    insertLinePrefix(view, '>');
    expect(view.state.doc.toString()).toBe('> line one\n\n> line three');
  });

  it('should handle heading prefix (#)', () => {
    const view = createView('hello', 0, 5);
    insertLinePrefix(view, '#');
    expect(view.state.doc.toString()).toBe('# hello');
  });
});
