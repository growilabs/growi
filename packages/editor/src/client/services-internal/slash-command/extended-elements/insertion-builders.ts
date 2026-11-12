import type { EditorView } from '@codemirror/view';
import type { Callout } from '@growi/core/dist/consts';

import type { SlashInsertion } from '../slash-command-types.js';

/**
 * Whether `from` sits in the middle of a line (some non-whitespace precedes it on
 * the same line). A small local copy of the base `insertion-builders`' helper: the
 * base module's public surface stays unchanged (this spec touches only the
 * composition point), so the primitive is duplicated rather than exported. Keep in
 * sync with `../insertion-builders.ts`.
 */
const hasPrecedingText = (view: EditorView, from: number): boolean => {
  const line = view.state.doc.lineAt(from);
  const before = line.text.slice(0, from - line.from);
  return before.trim() !== '';
};

/**
 * Build a position-free block {@link SlashInsertion}. When `from` is mid-line a
 * blank line (`\n\n`) is prefixed so the block starts fresh without being absorbed
 * into the preceding paragraph — both a fence and a container directive are block
 * constructs that need a blank line to interrupt a paragraph in GFM — and the
 * cursor offset shifts by the prefix length. `view` is read-only here (no dispatch).
 */
const buildBlockInsertion = (
  view: EditorView,
  from: number,
  body: string,
  bodyCursorOffset: number,
): SlashInsertion => {
  const prefix = hasPrecedingText(view, from) ? '\n\n' : '';
  return {
    insert: `${prefix}${body}`,
    cursorOffset: prefix.length + bodyCursorOffset,
  };
};

/**
 * Empty plantuml fenced block; the cursor lands on the empty content line.
 * `@startuml`/`@enduml` are omitted on purpose: `remark-simple-plantuml` encodes
 * the fence body as-is and the PlantUML server auto-wraps missing tags, so they are
 * not required — an empty fence (like a code block) keeps the template minimal.
 */
const PLANTUML_BODY = '```plantuml\n\n```';
const PLANTUML_CURSOR_OFFSET = '```plantuml\n'.length;

export const plantumlInsertion = (
  view: EditorView,
  from: number,
): SlashInsertion =>
  buildBlockInsertion(view, from, PLANTUML_BODY, PLANTUML_CURSOR_OFFSET);

/**
 * callout container directive (`:::<type>` … `:::`) with an empty body line; the
 * cursor lands on that body line so the user can type the content immediately.
 */
export const calloutInsertion =
  (type: Callout) =>
  (view: EditorView, from: number): SlashInsertion => {
    const body = `:::${type}\n\n:::`;
    const bodyCursorOffset = `:::${type}\n`.length;
    return buildBlockInsertion(view, from, body, bodyCursorOffset);
  };

/**
 * lsx directive `$lsx()` with the cursor placed inside the parentheses so the user
 * types options directly. Unlike plantuml/callout this is an INLINE growi directive
 * (`@growi/remark-growi-directive` Text/Leaf), so it needs no block separator and is
 * valid anywhere — including a table cell or list item. Position-free: it ignores
 * line context and always returns the same insertion (hence no `view`/`from`).
 */
export const lsxInsertion = (): SlashInsertion => ({
  insert: '$lsx()',
  cursorOffset: '$lsx('.length,
});
