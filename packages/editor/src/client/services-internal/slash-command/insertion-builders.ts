import type { EditorView } from '@codemirror/view';

import type {
  SlashInsertAction,
  SlashInsertion,
} from './slash-command-types.js';

/**
 * Separator prefixed before a block element when it is inserted in the middle of
 * a line (i.e. there is preceding non-whitespace text on the same line).
 *
 * - `'\n\n'` (blank line): required by tables and fenced code blocks. GFM does not
 *   let a table interrupt a paragraph, so a blank line must precede it for the
 *   block to render as a table rather than being absorbed into the paragraph.
 * - `'\n'` (single newline): headings, lists, numbered lists, task lists and
 *   quotes can interrupt a paragraph, so a single line break is enough.
 */
type BlockSeparator = '\n' | '\n\n';

/**
 * Whether `from` sits in the middle of a line, i.e. some non-whitespace text
 * precedes it on the same line. A line containing only leading whitespace before
 * `from` is treated as line start (Req 3.6).
 */
const hasPrecedingText = (view: EditorView, from: number): boolean => {
  const line = view.state.doc.lineAt(from);
  const before = line.text.slice(0, from - line.from);
  return before.trim() !== '';
};

/** Position-free description of a block element to insert. */
interface BlockSpec {
  /** The element text as inserted at line start (no separator prefix). */
  readonly body: string;
  /** Cursor offset within `body` (relative to the start of `body`). */
  readonly bodyCursorOffset: number;
  /** Separator prefixed when the element is inserted mid-line. */
  readonly separator: BlockSeparator;
}

/**
 * Build a position-free {@link SlashInsertion} for a block element.
 *
 * When `from` is mid-line, `spec.separator` is prefixed so the block starts on a
 * new line without breaking the preceding text, and `cursorOffset` is shifted by
 * the separator length. `view` is used solely to read the line context (line-start
 * detection); no dispatch or absolute-position mutation happens here.
 */
const buildBlockInsertion = (
  view: EditorView,
  from: number,
  spec: BlockSpec,
): SlashInsertion => {
  const prefix = hasPrecedingText(view, from) ? spec.separator : '';
  return {
    insert: `${prefix}${spec.body}`,
    cursorOffset: prefix.length + spec.bodyCursorOffset,
  };
};

/** Empty fenced code block; the cursor lands on the empty content line. */
const CODE_BLOCK_BODY = '```\n\n```';
/** Offset of the empty content line (length of the opening fence + newline). */
const CODE_BLOCK_CURSOR_OFFSET = '```\n'.length;

/**
 * 2-column empty Markdown table: header row + delimiter row + one body row.
 * The cursor lands inside the first header cell.
 */
const TABLE_BODY = '|  |  |\n| --- | --- |\n|  |  |';
/** Offset inside the first header cell (right after the leading `"| "`). */
const TABLE_CURSOR_OFFSET = '| '.length;

/**
 * Line-marker block (heading H1–H3 / bullet / numbered / task / quote). The
 * `marker` is the Markdown line prefix, e.g. `'# '`, `'- '`, `'1. '`, `'- [ ] '`,
 * `'> '`. The cursor lands right after the marker so the user can keep typing.
 */
export const lineMarkerInsertion =
  (marker: string): SlashInsertAction['buildInsertion'] =>
  (view, from) =>
    buildBlockInsertion(view, from, {
      body: marker,
      bodyCursorOffset: marker.length,
      separator: '\n',
    });

/** Empty fenced code block; the cursor lands on the empty content line. */
export const codeBlockInsertion: SlashInsertAction['buildInsertion'] = (
  view,
  from,
) =>
  buildBlockInsertion(view, from, {
    body: CODE_BLOCK_BODY,
    bodyCursorOffset: CODE_BLOCK_CURSOR_OFFSET,
    separator: '\n\n',
  });

/**
 * 2-column empty Markdown table (header + delimiter + 1 body row); the cursor
 * lands in the first header cell.
 */
export const tableInsertion: SlashInsertAction['buildInsertion'] = (
  view,
  from,
) =>
  buildBlockInsertion(view, from, {
    body: TABLE_BODY,
    bodyCursorOffset: TABLE_CURSOR_OFFSET,
    separator: '\n\n',
  });
