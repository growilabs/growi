// @vitest-environment jsdom
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';

import { toggleMarkdownSymbol } from './toggle-markdown-symbol';

const createView = (doc: string, anchor: number, head?: number): EditorView => {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.create([
      EditorSelection.range(anchor, head ?? anchor),
    ]),
  });
  return new EditorView({ state });
};

describe('toggleMarkdownSymbol', () => {
  it('should wrap selected text with prefix and suffix', () => {
    const view = createView('hello world', 0, 5);
    toggleMarkdownSymbol(view, '**', '**');
    expect(view.state.doc.toString()).toBe('**hello** world');
  });

  it('should unwrap text already wrapped with prefix and suffix', () => {
    const view = createView('**hello** world', 0, 9);
    toggleMarkdownSymbol(view, '**', '**');
    expect(view.state.doc.toString()).toBe('hello world');
  });

  it('should insert prefix+suffix and place cursor between them when no selection', () => {
    const view = createView('hello world', 5);
    toggleMarkdownSymbol(view, '**', '**');
    expect(view.state.doc.toString()).toBe('hello**** world');
    expect(view.state.selection.main.head).toBe(7);
  });

  it('should handle single-char symbols (backtick)', () => {
    const view = createView('code', 0, 4);
    toggleMarkdownSymbol(view, '`', '`');
    expect(view.state.doc.toString()).toBe('`code`');
  });

  it('should unwrap single-char symbols', () => {
    const view = createView('`code`', 0, 6);
    toggleMarkdownSymbol(view, '`', '`');
    expect(view.state.doc.toString()).toBe('code');
  });

  it('should handle multiline prefix/suffix (code block)', () => {
    const view = createView('some code', 0, 9);
    toggleMarkdownSymbol(view, '```\n', '\n```');
    expect(view.state.doc.toString()).toBe('```\nsome code\n```');
  });

  it('should handle asymmetric prefix and suffix (link)', () => {
    const view = createView('text', 0, 4);
    toggleMarkdownSymbol(view, '[', ']()');
    expect(view.state.doc.toString()).toBe('[text]()');
  });
});
