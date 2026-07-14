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
  /** The full text that replaces the `[from, to]` range. */
  readonly insert: string;
  /** Post-insertion cursor position, as an offset relative to `from`. */
  readonly cursorOffset: number;
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
  /** Builds the insertion content (text + cursor offset); pure, no side effects. */
  readonly buildInsertion: (view: EditorView, from: number) => SlashInsertion;
}

export interface SlashRunAction {
  readonly kind: 'run';
  /**
   * Side-effect handler invoked after `/query` has been deleted. The actual text
   * insertion is handled by `run` itself or by a subsequent modal.
   */
  readonly run: (view: EditorView, from: number) => void;
}

export type SlashCommandAction = SlashInsertAction | SlashRunAction;

/** A command definition (holds i18n keys; display strings are attached on resolution). */
export interface SlashCommand {
  /** Stable id, e.g. 'heading1'. */
  readonly id: string;
  /** i18n key, e.g. 'slash_command.heading1.label'. */
  readonly labelKey: string;
  readonly descriptionKey: string;
  /** Additional match terms, e.g. ['h1', 'title']. */
  readonly keywords: readonly string[];
  /** The action (insert: static insertion / run: side-effect launch). */
  readonly action: SlashCommandAction;
}

/** A command whose display strings have been resolved. */
export interface ResolvedSlashCommand extends SlashCommand {
  readonly label: string;
  readonly description: string;
}
