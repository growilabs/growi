// @vitest-environment jsdom
import { currentCompletions, startCompletion } from '@codemirror/autocomplete';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMentionCompletionExtension } from '../../services/mentionAutocompletionSettings';
import { baseExtensions } from '../../stores/use-default-extensions';
import { emojiAutocompletionSettings } from './emojiAutocompletionSettings';

// AC 4.4 — both sources loaded together (≈ defaults + mention); proves neither suppresses the other.
describe('AC 4.4: emoji and mention coexist on one shared facility (integration)', () => {
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
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor(pos),
        extensions: [
          ...baseExtensions,
          emojiAutocompletionSettings,
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

  it('surfaces emoji candidates at a ":smi" position while the mention source is also loaded', async () => {
    const labels = await labelsAt(':smi', 4);
    expect(labels.some((l) => l.startsWith(':'))).toBe(true);
  });

  it('surfaces the mention candidate at an "@ab" position while the emoji source is also loaded', async () => {
    const labels = await labelsAt('@ab', 3);
    expect(labels).toContain('@abc');
  });
});
