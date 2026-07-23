import { SLASH_COMMANDS } from './slash-command-definitions.js';

// Contract test for the single-source command set (Req 5.1, 5.4).
// We protect the observable set — exactly the 9 MVP commands, all `insert`,
// with `slash_command.*` i18n keys — and the exclusion of extended elements.
describe('slash-command-definitions', () => {
  const EXPECTED_IDS = [
    'heading1',
    'heading2',
    'heading3',
    'bulletList',
    'numberedList',
    'taskList',
    'quote',
    'codeBlock',
    'table',
  ] as const;

  // Extended elements are explicitly out of scope for this release (Req 5.4).
  const EXCLUDED_IDS = ['drawio', 'math', 'lsx', 'template'] as const;

  it('provides exactly the 9 MVP commands (Req 5.1)', () => {
    expect(SLASH_COMMANDS).toHaveLength(9);
    expect(SLASH_COMMANDS.map((c) => c.id)).toEqual([...EXPECTED_IDS]);
  });

  it('excludes extended-element commands (Req 5.4)', () => {
    const ids = SLASH_COMMANDS.map((c) => c.id);
    for (const excluded of EXCLUDED_IDS) {
      expect(ids).not.toContain(excluded);
    }
  });

  it('defines every command as an insert action wired to a builder function', () => {
    for (const command of SLASH_COMMANDS) {
      expect(command.action.kind).toBe('insert');
      if (command.action.kind === 'insert') {
        expect(typeof command.action.buildInsertion).toBe('function');
      }
    }
  });

  it('names i18n keys as slash_command.<id>.(label|description)', () => {
    for (const command of SLASH_COMMANDS) {
      expect(command.labelKey).toBe(`slash_command.${command.id}.label`);
      expect(command.descriptionKey).toBe(
        `slash_command.${command.id}.description`,
      );
    }
  });

  it('declares match keywords for every command', () => {
    for (const command of SLASH_COMMANDS) {
      expect(Array.isArray(command.keywords)).toBe(true);
      expect(command.keywords.length).toBeGreaterThan(0);
    }
  });

  it('gives every list command a "list" keyword so a "/list" prefix query surfaces them', () => {
    const listCommandIds = ['bulletList', 'numberedList', 'taskList'];
    for (const id of listCommandIds) {
      const command = SLASH_COMMANDS.find((c) => c.id === id);
      expect(command?.keywords).toContain('list');
    }
  });
});
