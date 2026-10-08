// @vitest-environment jsdom
import { currentCompletions, startCompletion } from '@codemirror/autocomplete';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { TFunction } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  baseExtensions,
  createSlashCommandExtension,
} from '../../../stores/use-default-extensions';
import {
  buildExtendedElementCommands,
  type ExtendedElementModalOpeners,
} from './use-extended-element-commands';

/**
 * Guards the composition point: extended commands passed to
 * `createSlashCommandExtension(t, extended)` (the real merge done in
 * `useDefaultExtensions`) actually surface through the shared autocomplete
 * facility — not just in isolation. Complements the base-only coexistence integ
 * (`slash-command-source.integ.ts`), which calls `createSlashCommandExtension(t)`
 * without extended commands.
 *
 * `t` is an identity stub, so labels surface as their raw `slash_command.*` keys.
 */
const t = ((key: string) => key) as unknown as TFunction;

const noopOpeners = (): ExtendedElementModalOpeners => ({
  openDrawio: vi.fn(),
  openLink: vi.fn(),
  openTableBuilder: vi.fn(),
});

describe('extended commands surface through the composed slash extension', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const labelsAt = async (
    doc: string,
    pos: number,
    editorKey?: string,
  ): Promise<string[]> => {
    const extended = buildExtendedElementCommands(editorKey, noopOpeners());
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor(pos),
        extensions: [
          ...baseExtensions,
          createSlashCommandExtension(t, extended),
        ],
      }),
    });
    startCompletion(view);
    await vi.advanceTimersByTimeAsync(50);
    const labels = currentCompletions(view.state).map((c) => c.label);
    view.destroy();
    return labels;
  };

  it('offers the static extended commands (plantuml / callout / lsx)', async () => {
    expect(await labelsAt('/plantuml', 9)).toContain(
      'slash_command.plantuml.label',
    );
    expect(await labelsAt('/callout', 8)).toContain(
      'slash_command.callout.note.label',
    );
    expect(await labelsAt('/lsx', 4)).toContain('slash_command.lsx.label');
    // id is `lsx`, so `/ls` reaches it too
    expect(await labelsAt('/ls', 3)).toContain('slash_command.lsx.label');
  });

  it('offers drawio only when editorKey is present', async () => {
    expect(await labelsAt('/drawio', 7, 'main')).toContain(
      'slash_command.drawio.label',
    );
    expect(await labelsAt('/drawio', 7, undefined)).not.toContain(
      'slash_command.drawio.label',
    );
  });

  it('still offers base commands alongside the extended ones', async () => {
    // `/head` matches the base heading commands; extended merge must not drop them
    expect(await labelsAt('/head', 5, 'main')).toContain(
      'slash_command.heading1.label',
    );
  });
});
