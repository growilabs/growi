// @vitest-environment jsdom
import {
  autocompletion,
  currentCompletions,
  startCompletion,
} from '@codemirror/autocomplete';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMentionCompletionExtension } from './mentionAutocompletionSettings';

// AC 4.2: mention completion must surface on the shared autocompletion() facility
// with no emoji extension present. The facility is built inline as defaultExtensions
// does, so this locks the contract (facility => mention surfaces), not the defaults wiring.
describe('mention completion via shared facility, no emoji (AC 4.2 — integration)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const mountAndComplete = async (withFacility: boolean) => {
    const fetchUsers = vi
      .fn()
      .mockResolvedValue([{ username: 'abc', name: 'Abc' }]);

    const doc = '@ab';
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [
        markdown({ base: markdownLanguage }),
        // emoji extension intentionally absent; only the standalone facility powers completion
        ...(withFacility ? [autocompletion({ icons: false })] : []),
        createMentionCompletionExtension(fetchUsers),
      ],
    });
    const view = new EditorView({ state });
    startCompletion(view);
    await vi.advanceTimersByTimeAsync(400); // debounce (300ms) + async fetch + dispatch
    const labels = currentCompletions(view.state).map((c) => c.label);
    view.destroy();
    return labels;
  };

  it('surfaces the mention completion when the standalone facility is present (no emoji)', async () => {
    const labels = await mountAndComplete(true);
    expect(labels).toContain('@abc');
  });

  // Negative control: no facility => no completion, so the positive test is failure-sensitive
  it('does NOT surface the mention completion when no facility is present', async () => {
    const labels = await mountAndComplete(false);
    expect(labels).not.toContain('@abc');
  });
});
