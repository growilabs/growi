import type {
  Completion,
  CompletionResult,
  CompletionSource,
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
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

interface SlashTrigger {
  readonly from: number;
  readonly query: string;
}

/**
 * lezer-markdown node names that denote a code context. Slash commands must not
 * fire here — inside a fenced/indented block or inline code the user is typing
 * code (paths, regexes, etc.), where a `/` menu would be a false trigger.
 */
const CODE_CONTEXT_NODE_NAMES = new Set([
  'FencedCode',
  'CodeBlock',
  'CodeText',
  'InlineCode',
]);

/** Whether `pos` sits inside a Markdown code context (fenced/indented/inline). */
const isInCodeContext = (state: EditorState, pos: number): boolean => {
  let node: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(
    state,
  ).resolveInner(pos, -1);
  while (node != null) {
    if (CODE_CONTEXT_NODE_NAMES.has(node.name)) return true;
    node = node.parent;
  }
  return false;
};

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
 * Whether `command` matches `query` case-insensitively against its `id`, its
 * localized `label`, or any of its keywords. An empty query matches everything
 * (Req 2.1, 2.2).
 *
 * Matching is PREFIX-based (`startsWith`), not substring: typing `/ta` must offer
 * "Table"/"Task list" but not "Quote" (whose keyword "citation" contains "ta"
 * mid-word). Prefix matching keeps the menu predictable — the query is the start
 * of a command name or keyword, as in Notion/Slack-style slash commands.
 *
 * The stable `id` (the English command name, e.g. `table`, `taskList`) is matched
 * too, so the English name works regardless of the display language — otherwise a
 * non-English label (e.g. ja "テーブル") would make `/ta` match nothing.
 */
const matchesQuery = (
  command: ResolvedSlashCommand,
  query: string,
): boolean => {
  if (query === '') return true;
  const needle = query.toLowerCase();
  return (
    command.id.toLowerCase().startsWith(needle) ||
    command.label.toLowerCase().startsWith(needle) ||
    command.keywords.some((keyword) => keyword.toLowerCase().startsWith(needle))
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

    if (isInCodeContext(context.state, context.pos)) return null;

    const options = entries
      .filter(({ command }) => matchesQuery(command, trigger.query))
      .map(({ completion }) => completion);

    return {
      from: trigger.from,
      to: context.pos,
      options,
      // Source-side matching (matchesQuery over label + keywords); disable
      // CodeMirror's own filtering. Deliberately NO `validFor`: with `filter:
      // false`, a `validFor` that still matched the growing `/query` would make
      // CodeMirror keep the initial option set without re-querying this source,
      // so the menu would never narrow as the user types. Omitting it forces a
      // re-query per keystroke, which re-runs matchesQuery and narrows correctly.
      filter: false,
    };
  };
};
