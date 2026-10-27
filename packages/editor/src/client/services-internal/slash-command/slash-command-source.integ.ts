// @vitest-environment jsdom
import { currentCompletions, startCompletion } from '@codemirror/autocomplete';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { TFunction } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMentionCompletionExtension } from '../../services/mentionAutocompletionSettings';
import {
  baseExtensions,
  createSlashCommandExtension,
} from '../../stores/use-default-extensions';
import { emojiAutocompletionSettings } from '../extensions/emojiAutocompletionSettings';

/**
 * Reproduces the comment-editor configuration, where all three completion
 * sources are live on one shared facility at once: `useDefaultExtensions`
 * contributes emoji + slash, and `CommentEditor` appends mention on top
 * (see apps/app .../PageComment/CommentEditor.tsx).
 *
 * Since slash, emoji, and mention all register as Markdown language-data
 * autocomplete sources (an `override` would replace the others and break
 * mention), this guards that none of the three suppresses the others.
 */
describe('slash + emoji + mention coexist on one shared facility (comment-editor config)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const labelsAt = async (doc: string, pos: number): Promise<string[]> => {
    const fetchUsers = vi
      .fn()
      .mockResolvedValue([{ username: 'abc', name: 'Abc' }]);
    // WHY the cast: `TFunction` is a large overloaded interface with no
    // reasonable non-cast construction; `createSlashCommandExtension` only
    // depends on its `(key) => string` shape (it passes `t` straight to
    // `resolveSlashCommands`), so an identity stub suffices — slash labels then
    // surface as their raw `slash_command.*` i18n keys.
    const t = ((key: string) => key) as unknown as TFunction;

    // The exact effective extension set of the comment editor: base + emoji +
    // slash (all from production wiring) plus the mention append. Using the real
    // `createSlashCommandExtension` (not a hand-rolled language-data source) makes
    // this fail if slash is ever switched to an `override` that wipes the others.
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor(pos),
        extensions: [
          ...baseExtensions,
          emojiAutocompletionSettings,
          createSlashCommandExtension(t),
          createMentionCompletionExtension(fetchUsers),
        ],
      }),
    });
    startCompletion(view);
    await vi.advanceTimersByTimeAsync(400); // mention debounce + async + dispatch
    const labels = currentCompletions(view.state).map((c) => c.label);
    view.destroy();
    return labels;
  };

  it('surfaces slash-command candidates at a "/head" position while emoji and mention are also loaded', async () => {
    const labels = await labelsAt('/head', 5);
    expect(labels.some((l) => l.startsWith('slash_command.'))).toBe(true);
  });

  it('surfaces emoji candidates at a ":smi" position while slash and mention are also loaded', async () => {
    const labels = await labelsAt(':smi', 4);
    expect(labels.some((l) => l.startsWith(':'))).toBe(true);
  });

  it('surfaces the mention candidate at an "@ab" position while slash and emoji are also loaded', async () => {
    const labels = await labelsAt('@ab', 3);
    expect(labels).toContain('@abc');
  });
});
