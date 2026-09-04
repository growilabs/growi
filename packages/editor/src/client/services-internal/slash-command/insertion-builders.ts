import type { EditorView } from '@codemirror/view';

import { BARE_LIST_MARKER_REGEX } from './list-line-patterns.js';
import { listItemGeometryAt } from './markdown-context.js';
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

/**
 * Offset (`< 0`) from `from` back to the first character of the list marker when
 * `from` sits right after a bare list marker, otherwise `null` (Req 9).
 */
const bareListMarkerOffsetAt = (
  view: EditorView,
  from: number,
): number | null => {
  const line = view.state.doc.lineAt(from);
  const before = line.text.slice(0, from - line.from);
  const match = BARE_LIST_MARKER_REGEX.exec(before);
  if (match == null) return null;

  const indent = match[1];
  return indent.length - before.length;
};

/**
 * How a line-marker command behaves when it fires on a bare list marker (Req 9).
 *
 * - `convert`: replace the item's own marker, keeping the indent — the
 *   numbered-list command turns `  - /` into `  1. `.
 * - `append`: keep the item's marker and add this one after it on the SAME line —
 *   the quote command turns `- /` into `- > ` (a quote inside the list item)
 *   instead of breaking out of the list onto a new line.
 *
 * Omitted (headings) means no list-specific handling; those commands are not
 * offered inside a list anyway (Req 8).
 */
export type ListItemBehavior = 'convert' | 'append';

interface BlockSpec {
  readonly body: string;
  readonly bodyCursorOffset: number;
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
  (
    marker: string,
    listItemBehavior?: ListItemBehavior,
  ): SlashInsertAction['buildInsertion'] =>
  (view, from) => {
    const markerFromOffset =
      listItemBehavior != null ? bareListMarkerOffsetAt(view, from) : null;

    if (markerFromOffset != null) {
      return {
        insert: marker,
        cursorOffset: marker.length,
        replaceFromOffset:
          listItemBehavior === 'convert' ? markerFromOffset : 0,
      };
    }

    // Somewhere else inside a list item — its marker line already has content
    // (`- foo /`) or this is one of its continuation lines (`  bar /`). Either
    // way the new line must carry the ITEM's prefix, or it lands at column 0 and
    // ends the list (Req 9.5). A list-type marker reproduces the prefix to become
    // a sibling at the same nesting level; a quote pads to the item's content
    // column to sit inside it.
    const geometry =
      listItemBehavior != null ? listItemGeometryAt(view.state, from) : null;
    if (geometry != null) {
      const linePrefix =
        listItemBehavior === 'convert'
          ? geometry.siblingPrefix
          : geometry.insidePrefix;
      const insert = `\n${linePrefix}${marker}`;
      return { insert, cursorOffset: insert.length };
    }

    return buildBlockInsertion(view, from, {
      body: marker,
      bodyCursorOffset: marker.length,
      separator: '\n',
    });
  };

/**
 * Empty fenced code block, always placed on its own new line. It has no
 * list-item case on purpose: nesting a fence into the item was tried and
 * rejected, and the command is excluded from list context instead (Req 8.1).
 */
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
