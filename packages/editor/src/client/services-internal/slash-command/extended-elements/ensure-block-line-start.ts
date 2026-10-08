import type { EditorView } from '@codemirror/view';

/**
 * Ensure a block element a `run` command is about to insert lands on its own line,
 * separated from any preceding paragraph text (Req 5.4).
 *
 * If `pos` is not at line start — some non-whitespace text precedes it on the same
 * line, e.g. `図: /drawio` — insert a BLANK line (`\n\n`) at `pos` and move the
 * cursor to the start of the resulting empty line, so the modal's later block
 * insertion is separated from the preceding paragraph by a blank line. A single
 * newline is not enough: GFM cannot let a table (or other block) interrupt a
 * paragraph without a blank line, so it would otherwise be absorbed and rendered as
 * literal text — the base `insertion-builders` use the same `\n\n` rule for
 * tables/fences. Otherwise the document is left untouched. At most one `view.dispatch`.
 *
 * Only block-element run commands (drawio / table-builder) call this; the inline
 * link command and the static inline lsx insert must NOT normalize (Req 9.1).
 */
export const ensureBlockLineStart = (view: EditorView, pos: number): void => {
  const line = view.state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  if (before.trim() === '') return; // already at (effective) line start

  view.dispatch({
    changes: { from: pos, insert: '\n\n' },
    selection: { anchor: pos + 2 },
  });
};
