// @vitest-environment jsdom
import type {
  CompletionResult,
  CompletionSource,
} from '@codemirror/autocomplete';
import {
  autocompletion,
  CompletionContext,
  currentCompletions,
  startCompletion,
} from '@codemirror/autocomplete';
import { history, undo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { lineMarkerInsertion } from './insertion-builders.js';
import { createSlashCommandSource } from './slash-command-source.js';
import type {
  ResolvedSlashCommand,
  SlashCommandAction,
} from './slash-command-types.js';

/** Build a resolved command with clean display strings for assertion clarity. */
const resolvedCommand = (
  partial: Pick<ResolvedSlashCommand, 'id' | 'label' | 'keywords' | 'action'>,
): ResolvedSlashCommand => ({
  labelKey: `slash_command.${partial.id}.label`,
  descriptionKey: `slash_command.${partial.id}.description`,
  description: `${partial.label} description`,
  ...partial,
});

const insertAction = (marker: string): SlashCommandAction => ({
  kind: 'insert',
  buildInsertion: lineMarkerInsertion(marker),
});

const HEADING1 = resolvedCommand({
  id: 'heading1',
  label: 'Heading 1',
  keywords: ['h1', 'title'],
  action: insertAction('# '),
});
const HEADING2 = resolvedCommand({
  id: 'heading2',
  label: 'Heading 2',
  keywords: ['h2'],
  action: insertAction('## '),
});
const QUOTE = resolvedCommand({
  id: 'quote',
  label: 'Quote',
  keywords: ['blockquote'],
  action: insertAction('> '),
});

const INSERT_COMMANDS: readonly ResolvedSlashCommand[] = [
  HEADING1,
  HEADING2,
  QUOTE,
];

/** Query the source against a throwaway state at `pos`. */
const queryAt = (
  source: CompletionSource,
  doc: string,
  pos: number,
): CompletionResult | null => {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(pos),
  });
  const result = source(new CompletionContext(state, pos, false));
  // The source is synchronous; narrow the CompletionSource union.
  if (result instanceof Promise) {
    throw new Error('source must be synchronous');
  }
  return result;
};

/**
 * Query the source against a Markdown-parsed state so the syntax tree carries
 * code nodes (FencedCode / InlineCode), letting the source detect code context.
 */
const queryAtInMarkdown = (
  source: CompletionSource,
  doc: string,
  pos: number,
): CompletionResult | null => {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(pos),
    extensions: [markdown({ base: markdownLanguage })],
  });
  const result = source(new CompletionContext(state, pos, false));
  if (result instanceof Promise) {
    throw new Error('source must be synchronous');
  }
  return result;
};

// Real EditorViews schedule a layout measure on requestAnimationFrame that jsdom
// cannot service; destroy them after each test to cancel the pending measure.
const createdViews: EditorView[] = [];
afterEach(() => {
  for (const view of createdViews.splice(0)) {
    view.destroy();
  }
});

/** A view with history so undo semantics can be observed. */
const createView = (doc: string, pos: number): EditorView => {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(pos),
      extensions: [history()],
    }),
  });
  createdViews.push(view);
  return view;
};

/** Resolve the completion for `label`, run its `apply`, exercising the real path. */
const applyCompletion = (
  result: CompletionResult,
  label: string,
  view: EditorView,
): void => {
  const option = result.options.find((o) => o.label === label);
  if (option == null) {
    throw new Error(`completion "${label}" not found`);
  }
  if (typeof option.apply !== 'function') {
    throw new Error('apply must be a function');
  }
  option.apply(
    view,
    option,
    result.from,
    result.to ?? view.state.selection.main.head,
  );
};

describe('createSlashCommandSource - trigger detection', () => {
  const source = createSlashCommandSource(INSERT_COMMANDS);

  it('fires at the very start of a line', () => {
    const result = queryAt(source, '/', 1);

    expect(result).not.toBeNull();
    expect(result?.from).toBe(0);
  });

  it('fires when only leading whitespace precedes the "/"', () => {
    const result = queryAt(source, '  /', 3);

    expect(result).not.toBeNull();
    expect(result?.from).toBe(2);
  });

  it('fires immediately after a whitespace character', () => {
    const result = queryAt(source, 'foo /', 5);

    expect(result).not.toBeNull();
    expect(result?.from).toBe(4);
  });

  it('does NOT fire in the middle of a word (non-whitespace before "/")', () => {
    const result = queryAt(source, 'foo/', 4);

    expect(result).toBeNull();
  });

  it('does NOT fire when there is no "/" before the cursor', () => {
    const result = queryAt(source, 'foo', 3);

    expect(result).toBeNull();
  });
});

describe('createSlashCommandSource - filtering', () => {
  const source = createSlashCommandSource(INSERT_COMMANDS);

  it('offers every command when the query is empty', () => {
    const result = queryAt(source, '/', 1);

    expect(result?.options.map((o) => o.label)).toEqual([
      'Heading 1',
      'Heading 2',
      'Quote',
    ]);
  });

  it('filters by label case-insensitively', () => {
    const result = queryAt(source, '/HEAD', 5);

    expect(result?.options.map((o) => o.label)).toEqual([
      'Heading 1',
      'Heading 2',
    ]);
  });

  it('filters by keyword case-insensitively', () => {
    const result = queryAt(source, '/H1', 3);

    expect(result?.options.map((o) => o.label)).toEqual(['Heading 1']);
  });

  it('matches the English id by prefix regardless of the localized label, ignoring mid-word keyword hits and the label itself', () => {
    // Localized labels (ja) that do NOT start with the romaji query, so the match
    // can only come from the English `id`. "quote" carries the keyword "citation"
    // whose "ta" is mid-word and must NOT match.
    const localizedSource = createSlashCommandSource([
      resolvedCommand({
        id: 'table',
        label: 'テーブル',
        keywords: ['grid'],
        action: insertAction(''),
      }),
      resolvedCommand({
        id: 'taskList',
        label: 'タスクリスト',
        keywords: ['todo'],
        action: insertAction(''),
      }),
      resolvedCommand({
        id: 'quote',
        label: '引用',
        keywords: ['blockquote', 'citation'],
        action: insertAction(''),
      }),
    ]);

    // English id prefix: "/ta" offers id "table"/"taskList"; "quote" must NOT
    // appear despite its keyword "citation" containing "ta" mid-word.
    expect(
      queryAt(localizedSource, '/ta', 3)?.options.map((o) => o.label),
    ).toEqual(['テーブル', 'タスクリスト']);

    // Full English name via id ("/table").
    expect(
      queryAt(localizedSource, '/table', 6)?.options.map((o) => o.label),
    ).toEqual(['テーブル']);

    // Req 2.6: the localized label is NOT matched, so what the user types to
    // reach a command is the same in every display language.
    expect(
      queryAt(localizedSource, '/テ', 2)?.options.map((o) => o.label),
    ).toEqual([]);
  });

  it('returns empty options (menu closes, doc unchanged) when nothing matches', () => {
    const result = queryAt(source, '/zzz', 4);

    expect(result).not.toBeNull();
    expect(result?.options).toEqual([]);
  });

  it('does NOT fire once whitespace is typed after the query (Req 4.3)', () => {
    const result = queryAt(source, '/head ', 6);

    expect(result).toBeNull();
  });

  // Req 2.5: a command the user is actually naming must outrank one that merely
  // carries a matching alias, otherwise `/c` buries "Code block" under commands
  // whose keywords happen to start with c.
  describe('orders name matches before keyword-only matches', () => {
    const ranked = createSlashCommandSource([
      // Declared alias-first on purpose: without ranking, declaration order wins
      // and this test would see the keyword match at the top.
      resolvedCommand({
        id: 'taskList',
        label: 'Task list',
        keywords: ['checkbox', 'check'],
        action: insertAction('- [ ] '),
      }),
      resolvedCommand({
        id: 'codeBlock',
        label: 'Code block',
        keywords: ['fence'],
        action: insertAction(''),
      }),
    ]);

    it('puts the name match first even when an alias match is declared earlier', () => {
      const result = queryAt(ranked, '/c', 2);

      expect(result?.options.map((o) => o.label)).toEqual([
        'Code block',
        'Task list',
      ]);
    });

    it('keeps declaration order among commands that match at the same rank', () => {
      const result = queryAt(ranked, '/', 1);

      expect(result?.options.map((o) => o.label)).toEqual([
        'Task list',
        'Code block',
      ]);
    });
  });

  it('exposes the description as completion detail', () => {
    const result = queryAt(source, '/H1', 3);

    expect(result?.options[0].detail).toBe('Heading 1 description');
  });
});

describe('createSlashCommandSource - completion detail precedence', () => {
  it('prefers syntaxHint over description when both are present', () => {
    const command: ResolvedSlashCommand = {
      ...resolvedCommand({
        id: 'heading1',
        label: 'Heading 1',
        keywords: ['h1'],
        action: insertAction('# '),
      }),
      syntaxHint: '#',
    };
    const source = createSlashCommandSource([command]);

    const result = queryAt(source, '/', 1);

    expect(result?.options[0].detail).toBe('#');
  });

  it('omits detail (not an empty string) when there is neither a syntaxHint nor a description', () => {
    const command: ResolvedSlashCommand = {
      ...resolvedCommand({
        id: 'table',
        label: 'Table',
        keywords: ['grid'],
        action: insertAction(''),
      }),
      description: '',
    };
    const source = createSlashCommandSource([command]);

    const result = queryAt(source, '/', 1);

    expect(result?.options[0].detail).toBeUndefined();
  });

  // i18next echoes the key when an entry is missing entirely (and would do so
  // for an empty entry too under `returnEmptyString: false`); showing
  // "slash_command.table.description" in the popup would be worse than nothing.
  it('omits detail when the description resolved to the i18n key itself', () => {
    const command: ResolvedSlashCommand = {
      ...resolvedCommand({
        id: 'table',
        label: 'Table',
        keywords: ['grid'],
        action: insertAction(''),
      }),
      description: 'slash_command.table.description',
    };
    const source = createSlashCommandSource([command]);

    const result = queryAt(source, '/', 1);

    expect(result?.options[0].detail).toBeUndefined();
  });
});

describe('createSlashCommandSource - apply (insert)', () => {
  const source = createSlashCommandSource(INSERT_COMMANDS);

  it('replaces "/query" with the element and places the cursor after the marker', () => {
    const view = createView('/h1', 3);
    const result = queryAt(source, '/h1', 3);
    expect(result).not.toBeNull();

    // biome-ignore lint/style/noNonNullAssertion: guarded above
    applyCompletion(result!, 'Heading 1', view);

    expect(view.state.doc.toString()).toBe('# ');
    expect(view.state.selection.main.head).toBe(2);
  });

  it('keeps the preceding text and starts the block on a new line mid-line', () => {
    const view = createView('foo /h1', 7);
    const result = queryAt(source, 'foo /h1', 7);
    expect(result).not.toBeNull();

    // biome-ignore lint/style/noNonNullAssertion: guarded above
    applyCompletion(result!, 'Heading 1', view);

    expect(view.state.doc.toString()).toBe('foo \n# ');
  });

  it('restores the original document with a SINGLE undo (Req 3.5)', () => {
    const view = createView('/h1', 3);
    const result = queryAt(source, '/h1', 3);

    // biome-ignore lint/style/noNonNullAssertion: presence asserted in sibling tests
    applyCompletion(result!, 'Heading 1', view);
    expect(view.state.doc.toString()).toBe('# ');

    undo(view);

    expect(view.state.doc.toString()).toBe('/h1');
  });
});

describe('createSlashCommandSource - apply (run)', () => {
  it('deletes only "/query" and then invokes run(view, from)', () => {
    const run = vi.fn();
    const runCommand = resolvedCommand({
      id: 'drawio',
      label: 'Drawio',
      keywords: ['diagram'],
      action: { kind: 'run', run },
    });
    const source = createSlashCommandSource([runCommand]);

    const view = createView('a /drawio', 9);
    const result = queryAt(source, 'a /drawio', 9);
    expect(result?.from).toBe(2);

    // biome-ignore lint/style/noNonNullAssertion: presence asserted above
    applyCompletion(result!, 'Drawio', view);

    // Only "/drawio" (range [2, 9]) is removed; the preceding "a " survives.
    expect(view.state.doc.toString()).toBe('a ');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(view, 2);
  });
});

describe('createSlashCommandSource - code context suppression', () => {
  const source = createSlashCommandSource(INSERT_COMMANDS);

  it('does not fire inside a fenced code block (slash at line start)', () => {
    const doc = '```\n/h1\n```';
    const pos = doc.indexOf('/h1') + 3; // cursor after "/h1" inside the block
    expect(queryAtInMarkdown(source, doc, pos)).toBeNull();
  });

  it('does not fire inside a fenced code block after whitespace', () => {
    const doc = '```\nfoo /h1\n```';
    const pos = doc.indexOf('/h1') + 3;
    expect(queryAtInMarkdown(source, doc, pos)).toBeNull();
  });

  it('does not fire inside inline code (slash after a space)', () => {
    const doc = '`a /h1`';
    const pos = doc.indexOf('/h1') + 3;
    expect(queryAtInMarkdown(source, doc, pos)).toBeNull();
  });

  it('still fires in normal Markdown prose (control)', () => {
    const doc = '/h1';
    const result = queryAtInMarkdown(source, doc, 3);
    expect(result).not.toBeNull();
    expect(result?.options.length).toBeGreaterThan(0);
  });
});

// Req 8: commands whose insertion would break the surrounding structure are
// excluded per-context via `disallowedIn`, not suppressed entirely (the menu
// itself still fires — unlike code context, which suppresses it wholesale).
describe('createSlashCommandSource - structural context filtering (Req 8)', () => {
  // Synthetic commands, one per `disallowedIn` shape, so this covers the
  // filtering MECHANISM. Which real command carries which shape is fixed by the
  // slash-command-definitions contract test instead.
  const bothRestricted: ResolvedSlashCommand = {
    ...resolvedCommand({
      id: 'bothRestricted',
      label: 'Both restricted',
      keywords: ['both'],
      action: insertAction('# '),
    }),
    disallowedIn: ['list', 'table'],
  };
  const tableOnlyRestricted: ResolvedSlashCommand = {
    ...resolvedCommand({
      id: 'tableOnlyRestricted',
      label: 'Table only restricted',
      keywords: ['tableonly'],
      action: insertAction('> '),
    }),
    disallowedIn: ['table'],
  };
  // No `disallowedIn` at all — proves the field is genuinely optional (Req 8.4).
  const unrestricted = resolvedCommand({
    id: 'unrestricted',
    label: 'Unrestricted',
    keywords: ['any'],
    action: insertAction('- '),
  });

  const source = createSlashCommandSource([
    bothRestricted,
    tableOnlyRestricted,
    unrestricted,
  ]);

  it('excludes only the list-restricted command inside a list item', () => {
    const doc = '- /';
    const pos = doc.indexOf('/') + 1;

    const result = queryAtInMarkdown(source, doc, pos);

    const labels = result?.options.map((o) => o.label);
    expect(labels).not.toContain('Both restricted');
    expect(labels).toContain('Table only restricted');
    expect(labels).toContain('Unrestricted');
  });

  it('excludes every table-restricted command inside a table cell', () => {
    const doc = '| a | b |\n| --- | --- |\n| / | c |';
    const pos = doc.indexOf('/') + 1;

    const result = queryAtInMarkdown(source, doc, pos);

    const labels = result?.options.map((o) => o.label);
    expect(labels).not.toContain('Both restricted');
    expect(labels).not.toContain('Table only restricted');
    expect(labels).toContain('Unrestricted');
  });

  it('offers every command outside list/table context (control)', () => {
    const doc = '/';
    const result = queryAtInMarkdown(source, doc, 1);

    const labels = result?.options.map((o) => o.label);
    expect(labels).toEqual([
      'Both restricted',
      'Table only restricted',
      'Unrestricted',
    ]);
  });

  // lezer-markdown keeps the line that FOLLOWS a table/list inside that node
  // until a blank line ends it. The cursor's own line must therefore also look
  // like the structure, or a single Enter after a table would leave the user
  // with a menu that has nothing in it.
  describe('the cursor own line must also look like the structure', () => {
    const labelsAt = (doc: string): string[] | undefined =>
      queryAtInMarkdown(source, doc, doc.lastIndexOf('/') + 1)?.options.map(
        (o) => o.label,
      );

    it('does not treat the line after a table row as table context', () => {
      const doc = '| a | b |\n| --- | --- |\n| c | d |\n/';

      expect(labelsAt(doc)).toContain('Table only restricted');
    });

    it('does not treat the line after a list item as list context', () => {
      const doc = '- foo\n/';

      expect(labelsAt(doc)).toContain('Both restricted');
    });

    it('still treats an actual table row as table context', () => {
      const doc = '| a | b |\n| --- | --- |\n| / | d |';

      expect(labelsAt(doc)).not.toContain('Table only restricted');
    });

    it('still treats a blockquote-nested list item as list context', () => {
      const doc = '> - /';

      expect(labelsAt(doc)).not.toContain('Both restricted');
      expect(labelsAt(doc)).toContain('Table only restricted');
    });

    // GFM lets a table omit its outer pipes, so a cell is not always on a line
    // that STARTS with one — the separator just has to be somewhere on the line.
    it('treats a pipe-less table row as table context', () => {
      const doc = 'a | b\n--- | ---\nc | /';

      expect(labelsAt(doc)).not.toContain('Table only restricted');
    });

    // An indented line under a list item carries no marker of its own but sits
    // at (or past) the item's content column, so it is still inside that item.
    it('treats a line indented to the item content column as list context', () => {
      const doc = '- foo\n  /';

      expect(labelsAt(doc)).not.toContain('Both restricted');
      expect(labelsAt(doc)).toContain('Table only restricted');
    });

    // Enter is `insertNewlineAndIndent`, which reproduces the current line's
    // indent — after `  - b` the next line already starts at column 2. Treating
    // any indentation as "still inside" would leave a nested list with no way
    // to reach the block-level commands at all, so the threshold is the item's
    // content column (4 here), not merely "is indented".
    it('does not treat a line outdented from the item content column as list context', () => {
      const doc = '- a\n  - b\n  /';

      expect(labelsAt(doc)).toContain('Both restricted');
    });
  });
});

// Integration: drive the real @codemirror/autocomplete plugin so the live
// re-query behaviour is exercised — a unit call to the source cannot catch a
// stale-menu regression (e.g. re-introducing `validFor` with `filter: false`).
describe('createSlashCommandSource - live narrowing via the autocomplete plugin', () => {
  const openMenuAndType = async (): Promise<{
    all: string[];
    narrowed: string[];
  }> => {
    const view = new EditorView({
      state: EditorState.create({
        doc: '',
        extensions: [
          autocompletion({
            override: [createSlashCommandSource(INSERT_COMMANDS)],
          }),
        ],
      }),
      parent: document.body,
    });
    createdViews.push(view);

    // Type "/" and open the menu (empty query offers every command).
    view.dispatch({
      changes: { from: 0, insert: '/' },
      selection: EditorSelection.cursor(1),
      userEvent: 'input.type',
    });
    startCompletion(view);
    await vi.advanceTimersByTimeAsync(100);
    const all = currentCompletions(view.state).map((c) => c.label);

    // Type "quote"; the menu must NARROW to the single matching command.
    view.dispatch({
      changes: { from: 1, insert: 'quote' },
      selection: EditorSelection.cursor(6),
      userEvent: 'input.type',
    });
    await vi.advanceTimersByTimeAsync(100);
    const narrowed = currentCompletions(view.state).map((c) => c.label);

    return { all, narrowed };
  };

  it('narrows the offered options as the query grows (no stale full list)', async () => {
    vi.useFakeTimers();
    try {
      const { all, narrowed } = await openMenuAndType();
      // Empty query offered every command...
      expect(all).toHaveLength(INSERT_COMMANDS.length);
      // ...and typing "quote" narrowed the live menu down to just "Quote".
      expect(narrowed).toEqual(['Quote']);
    } finally {
      vi.useRealTimers();
    }
  });

  // The rank order is only useful if the plugin shows it. `filter: false` is
  // what makes CodeMirror take this source's order verbatim, so pin the order
  // as the menu actually renders it, not just as the source returns it.
  it('shows the name match above the alias match in the live menu', async () => {
    vi.useFakeTimers();
    try {
      const aliasFirst = [
        // "Task list" matches `/c` only through its `checkbox` alias, and is
        // declared first, so an unranked menu would surface it at the top.
        resolvedCommand({
          id: 'taskList',
          label: 'Task list',
          keywords: ['checkbox'],
          action: insertAction('- [ ] '),
        }),
        resolvedCommand({
          id: 'codeBlock',
          label: 'Code block',
          keywords: ['fence'],
          action: insertAction(''),
        }),
      ];
      const view = new EditorView({
        state: EditorState.create({
          doc: '',
          extensions: [
            autocompletion({
              override: [createSlashCommandSource(aliasFirst)],
            }),
          ],
        }),
        parent: document.body,
      });
      createdViews.push(view);

      view.dispatch({
        changes: { from: 0, insert: '/c' },
        selection: EditorSelection.cursor(2),
        userEvent: 'input.type',
      });
      startCompletion(view);
      await vi.advanceTimersByTimeAsync(100);

      expect(currentCompletions(view.state).map((c) => c.label)).toEqual([
        'Code block',
        'Task list',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
