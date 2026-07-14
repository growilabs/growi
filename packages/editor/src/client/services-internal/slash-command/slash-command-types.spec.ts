// @vitest-environment jsdom
import type { EditorView } from '@codemirror/view';
import { mock } from 'vitest-mock-extended';

import type {
  ResolvedSlashCommand,
  SlashCommand,
  SlashInsertion,
} from './slash-command-types.js';

// Type-level contract test: these types drive later builders/source, so the
// contract we protect is the shape of an insertion (position-free) and that the
// action discriminated union narrows correctly on `action.kind`.
describe('slash-command-types', () => {
  const view = mock<EditorView>();

  describe('SlashInsertion', () => {
    it('represents an insertion with only replacement text and a from-relative cursor offset (no absolute position)', () => {
      const insertion: SlashInsertion = { insert: '# ', cursorOffset: 2 };

      expect(insertion.insert).toBe('# ');
      expect(insertion.cursorOffset).toBe(2);
    });
  });

  describe('SlashCommandAction (discriminated union)', () => {
    it('narrows an insert action to expose buildInsertion, which returns a SlashInsertion', () => {
      const command: SlashCommand = {
        id: 'heading1',
        labelKey: 'slash_command.heading1.label',
        descriptionKey: 'slash_command.heading1.description',
        keywords: ['h1', 'title'],
        action: {
          kind: 'insert',
          buildInsertion: (_view, from) => ({
            insert: '# ',
            cursorOffset: from === 0 ? 2 : 3,
          }),
        },
      };

      expect(command.action.kind).toBe('insert');
      // Narrowing on `kind` must expose buildInsertion (and only buildInsertion).
      if (command.action.kind === 'insert') {
        const insertion = command.action.buildInsertion(view, 0);
        expect(insertion).toEqual({ insert: '# ', cursorOffset: 2 });
      }
    });

    it('narrows a run action to expose run (the shared seam for side-effect commands)', () => {
      const run = vi.fn();
      const command: SlashCommand = {
        id: 'drawio',
        labelKey: 'slash_command.drawio.label',
        descriptionKey: 'slash_command.drawio.description',
        keywords: ['diagram'],
        action: { kind: 'run', run },
      };

      expect(command.action.kind).toBe('run');
      // Narrowing on `kind` must expose run (and only run).
      if (command.action.kind === 'run') {
        command.action.run(view, 5);
        expect(run).toHaveBeenCalledWith(view, 5);
      }
    });
  });

  describe('ResolvedSlashCommand', () => {
    it('extends SlashCommand with resolved label/description and remains usable as a SlashCommand', () => {
      const resolved: ResolvedSlashCommand = {
        id: 'heading1',
        labelKey: 'slash_command.heading1.label',
        descriptionKey: 'slash_command.heading1.description',
        keywords: ['h1'],
        action: {
          kind: 'insert',
          buildInsertion: () => ({ insert: '# ', cursorOffset: 2 }),
        },
        label: 'Heading 1',
        description: 'Large section heading',
      };

      // A ResolvedSlashCommand is assignable wherever a SlashCommand is expected.
      const asCommand: SlashCommand = resolved;

      expect(asCommand.id).toBe('heading1');
      expect(resolved.label).toBe('Heading 1');
      expect(resolved.description).toBe('Large section heading');
    });
  });
});
