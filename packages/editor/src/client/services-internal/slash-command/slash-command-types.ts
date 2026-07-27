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

export interface SlashCommand {
  readonly id: string;
  readonly labelKey: string;
  readonly descriptionKey: string;
  readonly keywords: readonly string[];
  readonly action: SlashCommandAction;
}

export interface ResolvedSlashCommand extends SlashCommand {
  readonly label: string;
  readonly description: string;
}
