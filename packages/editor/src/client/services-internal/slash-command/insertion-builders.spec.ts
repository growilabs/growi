// @vitest-environment jsdom
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';

import {
  codeBlockInsertion,
  lineMarkerInsertion,
  tableInsertion,
} from './insertion-builders.js';

const EMPTY_TABLE = '|  |  |\n| --- | --- |\n|  |  |';
const EMPTY_CODE_BLOCK = '```\n\n```';

/**
 * Build a view whose cursor sits at `from`. The builders inspect only the text
 * that precedes `from` on the same line to decide line-start vs mid-line, so the
 * document contents up to `from` are what matter.
 */
const createView = (doc: string, from: number): EditorView => {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.create([EditorSelection.cursor(from)]),
  });
  return new EditorView({ state });
};

describe('lineMarkerInsertion', () => {
  // marker -> expected cursor offset at line start (== marker length)
  const markers: readonly [string, number][] = [
    ['# ', 2],
    ['## ', 3],
    ['### ', 4],
    ['- ', 2],
    ['1. ', 3],
    ['- [ ] ', 6],
    ['> ', 2],
  ];

  describe('at line start', () => {
    it.each(
      markers,
    )('inserts marker "%s" verbatim with the cursor right after it', (marker, offset) => {
      const view = createView('', 0);

      const result = lineMarkerInsertion(marker)(view, 0);

      expect(result.insert).toBe(marker);
      expect(result.cursorOffset).toBe(offset);
    });

    it('treats a line with only leading whitespace as line start (no separator)', () => {
      const view = createView('   ', 3);

      const result = lineMarkerInsertion('# ')(view, 3);

      expect(result.insert).toBe('# ');
      expect(result.cursorOffset).toBe(2);
    });
  });

  describe('mid-line (preceding non-whitespace text)', () => {
    it.each(
      markers,
    )('prefixes a single newline before marker "%s" and shifts the cursor by 1', (marker, offset) => {
      // `from` points at the `/` that follows "hello "
      const view = createView('hello /', 6);

      const result = lineMarkerInsertion(marker)(view, 6);

      expect(result.insert).toBe(`\n${marker}`);
      expect(result.cursorOffset).toBe(offset + 1);
    });
  });
});

describe('codeBlockInsertion', () => {
  it('inserts an empty fenced code block with the cursor on the content line at line start', () => {
    const view = createView('', 0);

    const result = codeBlockInsertion(view, 0);

    expect(result.insert).toBe(EMPTY_CODE_BLOCK);
    // '```\n' == 4 chars; the empty content line begins there
    expect(result.cursorOffset).toBe(4);
  });

  it('prefixes a blank line (\\n\\n) when fired mid-line', () => {
    const view = createView('text /', 5);

    const result = codeBlockInsertion(view, 5);

    expect(result.insert).toBe(`\n\n${EMPTY_CODE_BLOCK}`);
    expect(result.cursorOffset).toBe(6);
  });
});

describe('tableInsertion', () => {
  it('inserts a 2-column table (header + delimiter + 1 body row) with the cursor in the first header cell at line start', () => {
    const view = createView('', 0);

    const result = tableInsertion(view, 0);

    expect(result.insert).toBe(EMPTY_TABLE);
    // '| ' == 2 chars; the cursor lands inside the first header cell
    expect(result.cursorOffset).toBe(2);
  });

  it('prefixes a blank line (\\n\\n) after a non-empty paragraph so GFM renders it as a table', () => {
    const view = createView('paragraph /', 10);

    const result = tableInsertion(view, 10);

    expect(result.insert).toBe(`\n\n${EMPTY_TABLE}`);
    expect(result.cursorOffset).toBe(4);
  });

  it('produces a blank line between the preceding paragraph and the table when applied', () => {
    const doc = 'paragraph /';
    const from = 10;
    const to = 11; // the trailing "/"
    const view = createView(doc, from);

    const { insert, cursorOffset } = tableInsertion(view, from);
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + cursorOffset },
    });

    // A blank line must separate the paragraph from the table for GFM rendering.
    expect(view.state.doc.toString()).toBe(`paragraph \n\n${EMPTY_TABLE}`);
    // Cursor sits inside the first header cell.
    expect(view.state.selection.main.head).toBe(from + cursorOffset);
  });
});

// Req 9: on a list item whose marker is the only content, a command must act
// INSIDE the item rather than breaking out onto a new unindented line. Asserted
// on the resulting document (the observable contract), composing the change the
// same way `apply` does — including the builder's backwards range widening.
describe('bare list marker behaviour (Req 9)', () => {
  /** Apply `build` over the trailing `/` of `doc`, as `apply` would. */
  const applyAtTrailingSlash = (
    doc: string,
    build: (
      view: EditorView,
      from: number,
    ) => {
      insert: string;
      cursorOffset: number;
      replaceFromOffset?: number;
    },
  ): { text: string; cursor: number } => {
    const to = doc.length;
    const from = to - 1; // the trailing "/"
    const view = createView(doc, from);

    const { insert, cursorOffset, replaceFromOffset = 0 } = build(view, from);
    const replaceFrom = from + replaceFromOffset;
    view.dispatch({
      changes: { from: replaceFrom, to, insert },
      selection: { anchor: replaceFrom + cursorOffset },
    });

    return {
      text: view.state.doc.toString(),
      cursor: view.state.selection.main.head,
    };
  };

  describe('convert: list-type commands replace the item own marker', () => {
    it('turns a nested bullet item into a numbered one, keeping the indent', () => {
      const { text } = applyAtTrailingSlash(
        '- aaa\n- bbb\n- ccc\n  - /',
        lineMarkerInsertion('1. ', 'convert'),
      );

      expect(text).toBe('- aaa\n- bbb\n- ccc\n  1. ');
    });

    it('turns a bullet item into a task item', () => {
      const { text } = applyAtTrailingSlash(
        '- foo\n- /',
        lineMarkerInsertion('- [ ] ', 'convert'),
      );

      expect(text).toBe('- foo\n- [ ] ');
    });

    it('turns a task item back into a bullet item (absorbs the checkbox)', () => {
      const { text } = applyAtTrailingSlash(
        '- [ ] foo\n- [ ] /',
        lineMarkerInsertion('- ', 'convert'),
      );

      expect(text).toBe('- [ ] foo\n- ');
    });

    it('keeps an enclosing blockquote and converts only the list marker', () => {
      const { text } = applyAtTrailingSlash(
        '> - /',
        lineMarkerInsertion('1. ', 'convert'),
      );

      expect(text).toBe('> 1. ');
    });

    it('places the cursor right after the converted marker', () => {
      const { text, cursor } = applyAtTrailingSlash(
        '  - /',
        lineMarkerInsertion('1. ', 'convert'),
      );

      expect(text).toBe('  1. ');
      expect(cursor).toBe(text.length);
    });
  });

  describe('append: quote is added after the item marker on the same line', () => {
    it('keeps the bullet and appends the quote marker', () => {
      const { text } = applyAtTrailingSlash(
        '- aaa\n- ccc\n- /',
        lineMarkerInsertion('> ', 'append'),
      );

      expect(text).toBe('- aaa\n- ccc\n- > ');
    });

    it('keeps the indent of a nested item', () => {
      const { text } = applyAtTrailingSlash(
        '- ccc\n  - /',
        lineMarkerInsertion('> ', 'append'),
      );

      expect(text).toBe('- ccc\n  - > ');
    });

    it('keeps an enclosing blockquote as well', () => {
      const { text } = applyAtTrailingSlash(
        '> - /',
        lineMarkerInsertion('> ', 'append'),
      );

      expect(text).toBe('> - > ');
    });
  });

  // codeBlock is not offered inside a list at all (Req 8.1), so it has no
  // list-item case here; its behaviour is covered by the codeBlockInsertion
  // suite above and its exclusion by the slash-command-definitions contract.

  describe('non-list positions keep the original block behaviour', () => {
    it('still breaks onto a new line after real text (not a bare marker)', () => {
      const { text } = applyAtTrailingSlash(
        '- foo /',
        lineMarkerInsertion('> ', 'append'),
      );

      expect(text).toBe('- foo \n> ');
    });

    it('still converts nothing when the line is plain prose', () => {
      const { text } = applyAtTrailingSlash(
        'foo /',
        lineMarkerInsertion('1. ', 'convert'),
      );

      expect(text).toBe('foo \n1. ');
    });

    it('still uses a blank line for a code block after prose', () => {
      const { text } = applyAtTrailingSlash('foo /', codeBlockInsertion);

      expect(text).toBe(`foo \n\n${EMPTY_CODE_BLOCK}`);
    });
  });
});
