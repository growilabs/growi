// @vitest-environment jsdom
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';

import type { SlashCommand } from '../slash-command-types.js';
import {
  buildExtendedElementCommands,
  type ExtendedElementModalOpeners,
} from './use-extended-element-commands.js';

const createView = (doc: string, pos: number): EditorView =>
  new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.create([EditorSelection.cursor(pos)]),
    }),
  });

const makeOpeners = (): ExtendedElementModalOpeners => ({
  openDrawio: vi.fn(),
  openLink: vi.fn(),
  openTableBuilder: vi.fn(),
});

const byId = (cmds: readonly SlashCommand[]) =>
  new Map(cmds.map((c) => [c.id, c]));

/** Narrow to a `run` action's callback or fail the test. */
const runOf = (cmd: SlashCommand | undefined) => {
  if (cmd == null || cmd.action.kind !== 'run') {
    throw new Error('expected a run command');
  }
  return cmd.action.run;
};

describe('buildExtendedElementCommands', () => {
  it('offers drawio only when editorKey is present', () => {
    expect(
      byId(buildExtendedElementCommands('main', makeOpeners())).has('drawio'),
    ).toBe(true);
    expect(
      byId(buildExtendedElementCommands(undefined, makeOpeners())).has(
        'drawio',
      ),
    ).toBe(false);
  });

  it('always offers link, table-builder and the static commands (editorKey or not)', () => {
    for (const editorKey of ['main', undefined] as const) {
      const m = byId(buildExtendedElementCommands(editorKey, makeOpeners()));
      expect(m.has('link')).toBe(true);
      expect(m.has('tableBuilder')).toBe(true);
      expect(m.has('plantuml')).toBe(true);
      expect(m.has('lsx')).toBe(true);
      expect(m.has('callout-note')).toBe(true);
    }
  });

  it('drawio: block-normalizes the line, then opens the modal with editorKey', () => {
    const openers = makeOpeners();
    const drawio = byId(buildExtendedElementCommands('main', openers)).get(
      'drawio',
    );
    const view = createView('図: ', 3); // mid-line trigger

    runOf(drawio)(view, 3);

    // observable: a blank line now separates the insertion point from the paragraph
    expect(view.state.doc.toString()).toBe('図: \n\n');
    expect(openers.openDrawio).toHaveBeenCalledWith('main');
  });

  it('table-builder: block-normalizes the line, then opens the modal with the view', () => {
    const openers = makeOpeners();
    const tableBuilder = byId(
      buildExtendedElementCommands('main', openers),
    ).get('tableBuilder');
    const view = createView('図: ', 3);

    runOf(tableBuilder)(view, 3);

    expect(view.state.doc.toString()).toBe('図: \n\n');
    expect(openers.openTableBuilder).toHaveBeenCalledWith(view);
  });

  it('link: inline — does NOT normalize; opens with a write-back onSave that inserts the link', () => {
    const openers = makeOpeners();
    const link = byId(buildExtendedElementCommands('main', openers)).get(
      'link',
    );
    const view = createView('図: ', 3);

    runOf(link)(view, 3);

    // inline element: the document is left untouched (no blank line inserted)
    expect(view.state.doc.toString()).toBe('図: ');
    expect(openers.openLink).toHaveBeenCalledTimes(1);

    // the onSave handed to the modal writes the confirmed link back into the editor
    const onSave = vi.mocked(openers.openLink).mock.calls[0][1];
    onSave('[title](https://example.com)');
    expect(view.state.doc.toString()).toContain('[title](https://example.com)');
  });
});
