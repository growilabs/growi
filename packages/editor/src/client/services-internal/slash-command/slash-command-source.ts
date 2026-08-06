import type {
  Completion,
  CompletionResult,
  CompletionSource,
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import type {
  ResolvedSlashCommand,
  SlashCommandContext,
} from './slash-command-types.js';

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

/**
 * lezer-markdown node names that denote a list-item line (Req 8). Any of
 * BulletList/OrderedList/TaskList wrap a `ListItem`, so matching `ListItem`
 * alone covers all three list kinds.
 */
const LIST_CONTEXT_NODE_NAMES = new Set(['ListItem']);

/**
 * lezer-markdown (GFM) node names that denote a table cell (Req 8). A table
 * cell cannot contain a blank line or block content, so it is a stricter
 * context than a list item.
 */
const TABLE_CONTEXT_NODE_NAMES = new Set([
  'Table',
  'TableRow',
  'TableCell',
  'TableHeader',
]);

/** Whether `pos`'s syntax-tree ancestor chain includes any of `nodeNames`. */
const matchesAncestorNode = (
  state: EditorState,
  pos: number,
  nodeNames: ReadonlySet<string>,
): boolean => {
  let node: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(
    state,
  ).resolveInner(pos, -1);
  while (node != null) {
    if (nodeNames.has(node.name)) return true;
    node = node.parent;
  }
  return false;
};

/** Whether `pos` sits inside a Markdown code context (fenced/indented/inline). */
const isInCodeContext = (state: EditorState, pos: number): boolean =>
  matchesAncestorNode(state, pos, CODE_CONTEXT_NODE_NAMES);

/** A list item line: indent, optional blockquote markers, then a list marker. */
const LIST_ITEM_LINE_REGEX = /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s/;

/** A table row line: indent, optional blockquote markers, then a cell pipe. */
const TABLE_ROW_LINE_REGEX = /^\s*(?:>\s*)*\|/;

/**
 * The {@link SlashCommandContext}s active at `pos` (Req 8).
 *
 * A context counts only when BOTH the syntax tree and the cursor's own line
 * agree, because either signal alone is wrong in a common case:
 * - tree alone over-reaches. lezer-markdown keeps the line that follows a table
 *   or a list item inside that node until a blank line ends it, so pressing
 *   Enter once after a table and typing `/` would still report `table` — and
 *   since every command excludes `table`, the menu would come up empty.
 * - line alone under-constrains. A line may start with `|` or `-` while being
 *   plain prose, and restricting the menu there would be a false positive.
 *
 * Both contexts can be active at once (a table nested inside a list item), so
 * the result is a set filtered uniformly against `disallowedIn`.
 */
const activeContextsAt = (
  state: EditorState,
  pos: number,
): readonly SlashCommandContext[] => {
  const lineText = state.doc.lineAt(pos).text;
  const contexts: SlashCommandContext[] = [];
  if (
    LIST_ITEM_LINE_REGEX.test(lineText) &&
    matchesAncestorNode(state, pos, LIST_CONTEXT_NODE_NAMES)
  ) {
    contexts.push('list');
  }
  if (
    TABLE_ROW_LINE_REGEX.test(lineText) &&
    matchesAncestorNode(state, pos, TABLE_CONTEXT_NODE_NAMES)
  ) {
    contexts.push('table');
  }
  return contexts;
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
    const {
      insert,
      cursorOffset,
      replaceFromOffset = 0,
    } = command.action.buildInsertion(view, from);
    // A builder may widen the replaced range backwards (e.g. to absorb a list
    // item's own marker when converting it); still one change, so still one undo.
    const replaceFrom = from + replaceFromOffset;
    view.dispatch({
      changes: { from: replaceFrom, to, insert },
      selection: { anchor: replaceFrom + cursorOffset },
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
  // Prefer the Markdown syntax itself as the hint where one exists (it IS the
  // explanation for a simple command); fall back to a written description,
  // omitting `detail` rather than an empty string so a not-yet-written
  // description doesn't render as blank space in the completion popup.
  detail:
    command.syntaxHint ??
    (command.description === '' ? undefined : command.description),
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

    // Req 8: exclude commands whose insertion would break the surrounding
    // structure at this position (e.g. a heading inside a list item, a table
    // inside a table cell). Commands with no `disallowedIn` are unaffected.
    const activeContexts = activeContextsAt(context.state, context.pos);
    const isAllowedHere = (command: ResolvedSlashCommand): boolean =>
      !activeContexts.some((c) => command.disallowedIn?.includes(c));

    const options = entries
      .filter(({ command }) => isAllowedHere(command))
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
