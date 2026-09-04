import type { EditorView } from '@codemirror/view';

/**
 * The content that replaces `/query` (the range `[from, to]`).
 *
 * It represents only position-free text plus the post-insertion cursor position
 * as an offset relative to `from`; it carries no absolute position. Composing the
 * deletion and insertion into a single `{ from, to, insert }` change is the caller's
 * responsibility (`apply`). Because the builder never holds an absolute-position
 * ChangeSpec, overlap/conflict with the deletion range cannot occur by construction.
 */
export interface SlashInsertion {
  readonly insert: string;
  readonly cursorOffset: number;
  /**
   * How far BEFORE `from` the replaced range starts (`<= 0`, default `0`), so a
   * builder can absorb text that precedes `/query` on the same line — e.g. the
   * list item's own marker when converting `  - /` into `  1. `.
   *
   * Still position-free: it is an offset relative to `from`, never an absolute
   * position, so `apply` remains the only place that composes a ChangeSpec.
   * `cursorOffset` is relative to the START of the replaced range, which is
   * `from` whenever this is `0`.
   */
  readonly replaceFromOffset?: number;
}

/**
 * A command action, expressed as a discriminated union of two kinds.
 * - insert: replaces `/query` (`[from, to]`) with static text (every MVP command).
 * - run:    deletes `/query` and then performs a side effect (e.g. launching a
 *           modal; used by the editor-slash-extended-elements spec).
 *
 * This lets "text insertion" and "side effects such as launching a modal" share a
 * single abstraction, so the base only has to call it from `apply` without knowing
 * the contents of `run` (e.g. drawio/lsx).
 */
export interface SlashInsertAction {
  readonly kind: 'insert';
  readonly buildInsertion: (view: EditorView, from: number) => SlashInsertion;
}

export interface SlashRunAction {
  readonly kind: 'run';
  readonly run: (view: EditorView, from: number) => void;
}

export type SlashCommandAction = SlashInsertAction | SlashRunAction;

/**
 * A syntax context in which a command's insertion would break the surrounding
 * Markdown structure (Req 8). `list` = inside a list item line (bullet/ordered/
 * task); `table` = inside a table cell.
 */
export type SlashCommandContext = 'list' | 'table';

export interface SlashCommand {
  readonly id: string;
  readonly labelKey: string;
  readonly descriptionKey: string;
  readonly keywords: readonly string[];
  readonly action: SlashCommandAction;
  /**
   * Contexts in which this command must NOT be offered, because inserting its
   * block-level content there would break the surrounding structure (e.g. a
   * heading inside a list item, a table inside a table cell). Omitted/empty
   * means the command is always offered.
   */
  readonly disallowedIn?: readonly SlashCommandContext[];
  /**
   * The literal Markdown marker shown in place of a description (e.g. `#`,
   * `>`) for a command simple enough that the notation IS the explanation.
   * Not localized: Markdown syntax is the same in every display language.
   * Omitted for commands whose result isn't a single-line marker (codeBlock,
   * table); those show their label alone, which already identifies them.
   */
  readonly syntaxHint?: string;
}

export interface ResolvedSlashCommand extends SlashCommand {
  readonly label: string;
  readonly description: string;
}
