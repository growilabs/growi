import type {
  Completion,
  CompletionResult,
  CompletionSource,
} from '@codemirror/autocomplete';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import type { ResolvedSlashCommand } from './slash-command-types.js';

/**
 * A slash token: a `/` followed by zero or more non-whitespace characters,
 * anchored to the end of the inspected text. A whitespace character therefore
 * terminates the token, so typing a space after `/query` stops the trigger
 * (menu closes, document untouched — Req 4.3).
 */
const SLASH_TOKEN_REGEX = /\/(\S*)$/;

/**
 * `validFor` regex: while the range text (from the `/`) keeps matching this,
 * CodeMirror re-filters without re-invoking the source. It stops matching as
 * soon as whitespace is typed, which closes the menu.
 */
const SLASH_QUERY_REGEX = /^\/\S*$/;

interface SlashTrigger {
  /** Absolute position of the `/`. */
  readonly from: number;
  /** Text typed after the `/` (may be empty). */
  readonly query: string;
}

/**
 * Detect a slash-command trigger ending at `pos`.
 *
 * Fires only when the `/` is at line start (nothing but leading whitespace
 * precedes it on the line) or immediately follows a whitespace character; it
 * does NOT fire in the middle of a word, e.g. `foo/` (Req 1.1, 1.2). Returns
 * `null` when not triggered.
 */
const detectSlashTrigger = (
  state: EditorState,
  pos: number,
): SlashTrigger | null => {
  const line = state.doc.lineAt(pos);
  const textBefore = line.text.slice(0, pos - line.from);

  const match = SLASH_TOKEN_REGEX.exec(textBefore);
  if (match == null) return null;

  const beforeSlash = textBefore.slice(0, match.index);
  // Line start (only leading whitespace) or right after a whitespace char.
  if (beforeSlash.length !== 0 && !/\s$/.test(beforeSlash)) return null;

  return { from: line.from + match.index, query: match[1] };
};

/**
 * Whether `command` matches `query` case-insensitively against its label or any
 * of its keywords. An empty query matches everything (Req 2.1, 2.2).
 */
const matchesQuery = (
  command: ResolvedSlashCommand,
  query: string,
): boolean => {
  if (query === '') return true;
  const needle = query.toLowerCase();
  if (command.label.toLowerCase().includes(needle)) return true;
  return command.keywords.some((keyword) =>
    keyword.toLowerCase().includes(needle),
  );
};

/**
 * Apply a chosen command over the `[from, to]` range (which spans `/query`).
 *
 * - `insert`: emit a SINGLE `view.dispatch` whose one change atomically replaces
 *   `[from, to]` with the built text, so a single undo restores the original
 *   document (Req 3.2, 3.5). A normal transaction keeps it Yjs-compatible (Req 6.3).
 * - `run`: delete `/query` in a single change, then invoke the side effect. The
 *   base does not know what `run` does (child specs supply drawio/lsx, etc.).
 */
const applyCommand = (
  command: ResolvedSlashCommand,
  view: EditorView,
  from: number,
  to: number,
): void => {
  if (command.action.kind === 'insert') {
    const { insert, cursorOffset } = command.action.buildInsertion(view, from);
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + cursorOffset },
    });
    return;
  }

  view.dispatch({
    changes: { from, to, insert: '' },
    selection: { anchor: from },
  });
  command.action.run(view, from);
};

const toCompletion = (command: ResolvedSlashCommand): Completion => ({
  label: command.label,
  detail: command.description,
  apply: (view, _completion, from, to) => applyCommand(command, view, from, to),
});

/**
 * Build a CodeMirror {@link CompletionSource} for the given slash commands.
 *
 * The source RECEIVES its work-set as input (it does not own the command set),
 * so callers compose it with any resolved command list. Escape / blur /
 * outside-click closing is handled by `@codemirror/autocomplete` itself; this
 * source only decides when to offer completions and how to apply them.
 */
export const createSlashCommandSource = (
  commands: readonly ResolvedSlashCommand[],
): CompletionSource => {
  // Precompute one Completion per command; `apply` receives from/to at call time.
  const entries = commands.map((command) => ({
    command,
    completion: toCompletion(command),
  }));

  return (context): CompletionResult | null => {
    const trigger = detectSlashTrigger(context.state, context.pos);
    if (trigger == null) return null;

    const options = entries
      .filter(({ command }) => matchesQuery(command, trigger.query))
      .map(({ completion }) => completion);

    return {
      from: trigger.from,
      to: context.pos,
      options,
      // Source-side matching (matchesQuery); disable CodeMirror's own filtering.
      filter: false,
      validFor: SLASH_QUERY_REGEX,
    };
  };
};
