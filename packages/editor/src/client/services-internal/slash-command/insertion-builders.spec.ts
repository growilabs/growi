// @vitest-environment jsdom
import { CompletionContext } from '@codemirror/autocomplete';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';

import {
  codeBlockInsertion,
  lineMarkerInsertion,
  tableInsertion,
} from './insertion-builders.js';
import { createSlashCommandSource } from './slash-command-source.js';
import type {
  ResolvedSlashCommand,
  SlashInsertAction,
} from './slash-command-types.js';

const EMPTY_TABLE = '|  |  |\n| --- | --- |\n|  |  |';
const EMPTY_CODE_BLOCK = '```\n\n```';

/**
 * Build a view whose cursor sits at `from`, with Markdown parsing enabled as in
 * production: the builders read the syntax tree to find the enclosing list item,
 * so a view without the language would report no list at all.
 */
const createView = (doc: string, from: number): EditorView => {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.create([EditorSelection.cursor(from)]),
    extensions: [markdown({ base: markdownLanguage })],
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
// on the resulting document (the observable contract).
describe('bare list marker behaviour (Req 9)', () => {
  /**
   * Apply `buildInsertion` over the trailing `/` of `doc` through the PRODUCTION
   * path: the completion source's own `apply` composes the ChangeSpec, including
   * the backwards range widening (`replaceFromOffset`). Dispatching by hand here
   * would re-implement that composition, so a regression in it — e.g. dropping
   * `replaceFromOffset` and never absorbing the item's marker — would go unseen.
   */
  const applyAtTrailingSlash = (
    doc: string,
    buildInsertion: SlashInsertAction['buildInsertion'],
  ): { text: string; cursor: number } => {
    const command: ResolvedSlashCommand = {
      id: 'probe',
      labelKey: 'slash_command.probe.label',
      descriptionKey: 'slash_command.probe.description',
      label: 'Probe',
      description: '',
      keywords: ['probe'],
      action: { kind: 'insert', buildInsertion },
    };
    const source = createSlashCommandSource([command]);

    const to = doc.length;
    const from = to - 1; // the trailing "/"
    const view = createView(doc, from);

    const result = source(new CompletionContext(view.state, to, false));
    if (result == null || result instanceof Promise) {
      throw new Error('source must return a synchronous result here');
    }
    const option = result.options[0];
    if (typeof option?.apply !== 'function') {
      throw new Error('apply must be a function');
    }
    option.apply(view, option, result.from, result.to ?? to);

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

  // Req 9.5: a list item that already has content is still a list item — the
  // new line has to carry the item's prefix or it lands at column 0 and ends
  // the list. This is the case code review flagged for quote.
  describe('content-bearing list line keeps the block inside the list', () => {
    it('indents a quote to the item content column instead of leaving the list', () => {
      const { text } = applyAtTrailingSlash(
        '- foo /',
        lineMarkerInsertion('> ', 'append'),
      );

      expect(text).toBe('- foo \n  > ');
    });

    it('reproduces the prefix so a list marker becomes a sibling at the same level', () => {
      const { text } = applyAtTrailingSlash(
        '- a\n  - foo /',
        lineMarkerInsertion('1. ', 'convert'),
      );

      expect(text).toBe('- a\n  - foo \n  1. ');
    });

    // The item's own line is the reference, not the cursor's line: a
    // continuation line carries no marker, so deriving the prefix from it would
    // drop the block to column 0 and end the list.
    it('uses the item prefix from a continuation line too', () => {
      expect(
        applyAtTrailingSlash(
          '- foo\n  bar /',
          lineMarkerInsertion('> ', 'append'),
        ).text,
      ).toBe('- foo\n  bar \n  > ');
      expect(
        applyAtTrailingSlash(
          '- a\n  - foo\n    bar /',
          lineMarkerInsertion('- ', 'convert'),
        ).text,
      ).toBe('- a\n  - foo\n    bar \n  - ');
    });

    // The content column is the marker plus ALL the whitespace after it, and a
    // tab counts as a full tab stop — otherwise the quote lands short of the
    // item's text and renders outside the list.
    it('measures the content column past multiple spaces and tabs', () => {
      expect(
        applyAtTrailingSlash('-   foo /', lineMarkerInsertion('> ', 'append'))
          .text,
      ).toBe('-   foo \n    > ');
      expect(
        applyAtTrailingSlash('-\tfoo /', lineMarkerInsertion('> ', 'append'))
          .text,
      ).toBe('-\tfoo \n    > ');
    });

    it('keeps an enclosing blockquote on both the sibling and the inside case', () => {
      expect(
        applyAtTrailingSlash('> - foo /', lineMarkerInsertion('- ', 'convert'))
          .text,
      ).toBe('> - foo \n> - ');
      expect(
        applyAtTrailingSlash('> - foo /', lineMarkerInsertion('> ', 'append'))
          .text,
      ).toBe('> - foo \n>   > ');
    });
  });

  describe('non-list positions keep the original block behaviour', () => {
    it('still breaks onto a plain new line for a quote after prose', () => {
      const { text } = applyAtTrailingSlash(
        'foo /',
        lineMarkerInsertion('> ', 'append'),
      );

      expect(text).toBe('foo \n> ');
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
