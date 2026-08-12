/**
 * List-line patterns shared by the completion source and the insertion builders.
 *
 * The source decides whether a position counts as `list` context (Req 8) and the
 * builders decide whether a conversion may absorb the item's own marker (Req 9).
 * Both must recognise the same marker grammar: if only one of them is updated,
 * the menu offers a conversion that the builder then silently declines to
 * perform (`- /` would become `- ` + newline + `- `). Deriving both regexes from
 * the same sources here makes that drift impossible.
 */

/** The marker itself: `-`, `*`, `+`, `1.`, `1)`. */
const MARKER = String.raw`(?:[-*+]|\d+[.)])`;

/** Indent plus any blockquote markers that may precede a list marker. */
const LINE_PREFIX = String.raw`\s*(?:>\s*)*`;

/** A line that OPENS a list item — prefix, marker, then whitespace. */
export const LIST_MARKER_LINE_REGEX = new RegExp(
  String.raw`^${LINE_PREFIX}${MARKER}\s`,
);

/**
 * A bare list marker: the marker (plus an optional task checkbox) is the ONLY
 * content before the insertion point, e.g. `- /`, `  1. /`, `- [ ] /`, `> - /`.
 * Group 1 captures the prefix, so a conversion replaces just the marker and
 * keeps both the nesting depth and any enclosing blockquote.
 */
export const BARE_LIST_MARKER_REGEX = new RegExp(
  String.raw`^(${LINE_PREFIX})${MARKER}[ \t]+(?:\[[ xX]\][ \t]+)?$`,
);
