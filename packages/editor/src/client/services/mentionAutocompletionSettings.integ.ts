// @vitest-environment jsdom
import { currentCompletions, startCompletion } from '@codemirror/autocomplete';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  EditorSelection,
  EditorState,
  type Extension,
} from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { baseExtensions } from '../stores/use-default-extensions';
import { createMentionCompletionExtension } from './mentionAutocompletionSettings';

// AC 4.2: mention must surface on the REAL baseExtensions (no emoji). Removing the
// shared facility from baseExtensions makes the positive case below fail.
describe('mention completion via shared facility, no emoji (AC 4.2 — integration)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const surfacedLabels = async (extensions: Extension[]): Promise<string[]> => {
    const fetchUsers = vi
      .fn()
      .mockResolvedValue([{ username: 'abc', name: 'Abc' }]);
    const doc = '@ab';
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor(doc.length),
        extensions: [
          ...extensions,
          createMentionCompletionExtension(fetchUsers),
        ],
      }),
    });
    startCompletion(view);
    await vi.advanceTimersByTimeAsync(400); // debounce (300ms) + async fetch + dispatch
    const labels = currentCompletions(view.state).map((c) => c.label);
    view.destroy();
    return labels;
  };

  it('surfaces the mention completion on the real baseExtensions (no emoji)', async () => {
    expect(await surfacedLabels(baseExtensions)).toContain('@abc');
  });

  // Negative control: no facility => no completion, so the positive test is failure-sensitive.
  it('does NOT surface the mention completion when no facility is present', async () => {
    expect(
      await surfacedLabels([markdown({ base: markdownLanguage })]),
    ).not.toContain('@abc');
  });
});
