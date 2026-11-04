import type { TFunction } from 'i18next';

import { resolveSlashCommands } from './resolve-slash-commands.js';
import { SLASH_COMMANDS } from './slash-command-definitions.js';
import type { SlashCommand } from './slash-command-types.js';

/**
 * Build a minimal `t` stub for tests.
 *
 * The resolver only ever calls `t(key)` and expects a string back, so the stub
 * models a single dictionary and, for any key it does not know, returns the
 * `fallback` map's value (simulating i18next's `fallbackLng` collapsing an
 * untranslated key onto the default-language string — Req 7.2). We do NOT stand
 * up a real i18next instance; the resolver's contract is only that it surfaces
 * whatever `t` returns.
 *
 * WHY the cast: `TFunction` is a large overloaded interface with no reasonable
 * non-cast construction; the resolver only depends on its `(key) => string`
 * shape. This is confined to this one helper.
 */
const buildT = (
  dictionary: Record<string, string>,
  fallback: Record<string, string> = {},
): TFunction => {
  const t = (key: string): string => dictionary[key] ?? fallback[key] ?? key;
  return t as unknown as TFunction;
};

describe('resolveSlashCommands', () => {
  it('attaches label/description resolved via t to every command (Req 1.3, 7.1)', () => {
    const t = buildT({
      'slash_command.heading1.label': 'Heading 1',
      'slash_command.heading1.description': 'Large section heading',
    });

    const command: SlashCommand = {
      id: 'heading1',
      labelKey: 'slash_command.heading1.label',
      descriptionKey: 'slash_command.heading1.description',
      keywords: ['h1', 'title'],
      action: {
        kind: 'insert',
        buildInsertion: () => ({ insert: '', cursorOffset: 0 }),
      },
    };

    const [resolved] = resolveSlashCommands(t, [command]);

    expect(resolved.label).toBe('Heading 1');
    expect(resolved.description).toBe('Large section heading');
  });

  it('preserves the original command fields (id/keywords/action/keys)', () => {
    const t = buildT({});
    const command: SlashCommand = {
      id: 'quote',
      labelKey: 'slash_command.quote.label',
      descriptionKey: 'slash_command.quote.description',
      keywords: ['blockquote', 'citation'],
      action: {
        kind: 'insert',
        buildInsertion: () => ({ insert: '> ', cursorOffset: 2 }),
      },
    };

    const [resolved] = resolveSlashCommands(t, [command]);

    expect(resolved.id).toBe(command.id);
    expect(resolved.labelKey).toBe(command.labelKey);
    expect(resolved.descriptionKey).toBe(command.descriptionKey);
    expect(resolved.keywords).toEqual(command.keywords);
    expect(resolved.action).toBe(command.action);
  });

  it('defaults to SLASH_COMMANDS when the commands argument is omitted', () => {
    const t = buildT({});

    const resolved = resolveSlashCommands(t);

    expect(resolved).toHaveLength(SLASH_COMMANDS.length);
    expect(resolved.map((c) => c.id)).toEqual(SLASH_COMMANDS.map((c) => c.id));
  });

  it('falls back to the default-language string for an untranslated key (Req 7.2)', () => {
    // Current language has no entry for the label key; the fallback map (default
    // language) does. A real i18next `t` collapses this via fallbackLng; the stub
    // reproduces that, and the resolver must surface the returned string verbatim.
    const t = buildT(
      { 'slash_command.table.description': '2列のテーブル' },
      { 'slash_command.table.label': 'Table' },
    );

    const command: SlashCommand = {
      id: 'table',
      labelKey: 'slash_command.table.label',
      descriptionKey: 'slash_command.table.description',
      keywords: ['grid'],
      action: {
        kind: 'insert',
        buildInsertion: () => ({ insert: '', cursorOffset: 0 }),
      },
    };

    const [resolved] = resolveSlashCommands(t, [command]);

    expect(resolved.label).toBe('Table');
    expect(resolved.description).toBe('2列のテーブル');
  });

  it('is pure: does not mutate the input command objects', () => {
    const t = buildT({ 'k.label': 'L', 'k.description': 'D' });
    const command: SlashCommand = {
      id: 'x',
      labelKey: 'k.label',
      descriptionKey: 'k.description',
      keywords: ['x'],
      action: {
        kind: 'insert',
        buildInsertion: () => ({ insert: '', cursorOffset: 0 }),
      },
    };
    const snapshot = { ...command };

    resolveSlashCommands(t, [command]);

    expect(command).toEqual(snapshot);
    expect('label' in command).toBe(false);
  });
});
