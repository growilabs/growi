import type {
  Completion,
  CompletionResult,
  CompletionSource,
} from '@codemirror/autocomplete';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import { LIST_MARKER_LINE_REGEX } from './list-line-patterns.js';
import {
  findAncestorNode,
  indentWidth,
  listItemGeometryAt,
} from './markdown-context.js';
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
): boolean => findAncestorNode(state, pos, nodeNames) != null;

/** Whether `pos` sits inside a Markdown code context (fenced/indented/inline). */
const isInCodeContext = (state: EditorState, pos: number): boolean =>
  matchesAncestorNode(state, pos, CODE_CONTEXT_NODE_NAMES);

/**
 * A cell separator anywhere on the line. Deliberately NOT anchored to the line
 * start: GFM also accepts tables whose rows omit the leading and trailing pipe
 * (`a | b` / `--- | ---` / `c | d`), and anchoring would leave those cells
 * unprotected.
 */
const TABLE_CELL_SEPARATOR_REGEX = /\|/;

/**
 * Whether `pos` is inside the innermost enclosing list item (Req 8.1).
 *
 * A line belongs to that item when it carries a marker of its own, or when it is
 * indented at least to the item's CONTENT column. The content column — not "is
 * indented at all" — is the threshold that matters, because Enter is bound to
 * `insertNewlineAndIndent`, which reproduces the current line's indent: after
 * `  - b` the next line already starts at column 2, so treating any indentation
 * as "still inside" would leave a nested list with no way to reach the
 * block-level commands at all, not even by pressing Enter twice.
 */
const isInListItem = (state: EditorState, pos: number): boolean => {
  const geometry = listItemGeometryAt(state, pos);
  if (geometry == null) return false;

  const lineText = state.doc.lineAt(pos).text;
  if (LIST_MARKER_LINE_REGEX.test(lineText)) return true;

  return indentWidth(lineText) >= geometry.contentColumn;
};

/**
 * The {@link SlashCommandContext}s active at `pos` (Req 8).
 *
 * A context counts only when BOTH the syntax tree and the cursor's own line
 * agree, because either signal alone is wrong in a common case:
 * - tree alone over-reaches. lezer-markdown keeps the line that follows a table
 *   or a list item inside that node until a blank line ends it, so pressing
 *   Enter after a table and typing `/` would still report `table` — and since
 *   every command excludes `table`, the menu would come up empty. Requiring the
 *   line to still look like the structure treats a separator-less, outdented
 *   line as "the user has left it".
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
  if (isInListItem(state, pos)) {
    contexts.push('list');
  }
  if (
    TABLE_CELL_SEPARATOR_REGEX.test(lineText) &&
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
 * Where a query matched a command. The menu is ordered by this, so a command
 * the user is actually naming outranks one that merely carries a matching alias
 * (Req 2.5): `/c` offers "Code block" before "Task list", whose `checkbox`
 * keyword also starts with `c`.
 */
const MATCH_RANK = {
  /** The query is a prefix of the command's own name — its stable `id`. */
  name: 0,
  /** The query only matched one of the command's alias keywords. */
  keyword: 1,
} as const;
type MatchRank = (typeof MATCH_RANK)[keyof typeof MATCH_RANK];

/**
 * How `command` matches `query` case-insensitively, or `null` when it does not.
 * An empty query matches everything at {@link MATCH_RANK.name} (Req 2.1, 2.2).
 *
 * Matching is PREFIX-based (`startsWith`), not substring: typing `/ta` must offer
 * "Table"/"Task list" but not "Quote" (whose keyword "citation" contains "ta"
 * mid-word). Prefix matching keeps the menu predictable — the query is the start
 * of a command name or keyword, as in Notion/Slack-style slash commands.
 *
 * The localized `label` is deliberately NOT matched (Req 2.6): the query is
 * always the English `id` or one of the English `keywords`, so what a user types
 * to reach a command does not change with the display language.
 */
const matchRank = (
  command: ResolvedSlashCommand,
  query: string,
): MatchRank | null => {
  if (query === '') return MATCH_RANK.name;
  const needle = query.toLowerCase();
  if (command.id.toLowerCase().startsWith(needle)) {
    return MATCH_RANK.name;
  }
  if (
    command.keywords.some((keyword) => keyword.toLowerCase().startsWith(needle))
  ) {
    return MATCH_RANK.keyword;
  }
  return null;
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

/**
 * The auxiliary text shown beside a command's label (Req 10.1, 10.3, 10.4).
 *
 * The Markdown syntax wins where a command has one — it IS the explanation for a
 * simple command. Otherwise a written description is used, but only when there
 * actually is one: i18next yields `''` for a key whose value is empty and echoes
 * the key itself when the entry is missing, and neither belongs in the popup.
 */
const resolveDetail = (command: ResolvedSlashCommand): string | undefined => {
  if (command.syntaxHint != null) return command.syntaxHint;
  const { description, descriptionKey } = command;
  if (description === '' || description === descriptionKey) return undefined;
  return description;
};

const toCompletion = (command: ResolvedSlashCommand): Completion => ({
  label: command.label,
  detail: resolveDetail(command),
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

    // Sort is stable, so commands sharing a rank keep their declaration order.
    const options = entries
      .filter(({ command }) => isAllowedHere(command))
      .flatMap(({ command, completion }) => {
        const rank = matchRank(command, trigger.query);
        return rank == null ? [] : [{ completion, rank }];
      })
      .sort((a, b) => a.rank - b.rank)
      .map(({ completion }) => completion);

    return {
      from: trigger.from,
      to: context.pos,
      options,
      // Source-side matching and ordering (`matchRank` over id + keywords).
      // `filter: false` is required, not a preference: `from` points AT the `/`,
      // so CodeMirror's own filter would match option labels against "/c" and
      // find nothing — the menu comes up empty (measured). Leaving it off also
      // makes CodeMirror take this source's order verbatim, which is what keeps
      // name matches above alias matches (Req 2.5).
      // Deliberately NO `validFor`: with `filter: false`, a `validFor` that still
      // matched the growing `/query` would make CodeMirror keep the initial
      // option set without re-querying this source, so the menu would never
      // narrow as the user types. Omitting it forces a re-query per keystroke,
      // which re-runs `matchRank` and narrows correctly.
      filter: false,
    };
  };
};
