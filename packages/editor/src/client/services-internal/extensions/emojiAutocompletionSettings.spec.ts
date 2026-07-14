// @vitest-environment jsdom
import {
  CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';

import {
  emojiAutocompletionSettings,
  emojiCompletionSource,
  emojiRenderOption,
} from './emojiAutocompletionSettings.js';

/** Query the emoji source against a throwaway state at `pos`. */
const queryAt = (
  doc: string,
  pos: number,
  explicit = false,
): CompletionResult | null => {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(pos),
  });
  const result = emojiCompletionSource(
    new CompletionContext(state, pos, explicit),
  );
  // The source is synchronous; narrow the CompletionSource union.
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

const createView = (): EditorView => {
  const view = new EditorView({ state: EditorState.create({ doc: '' }) });
  createdViews.push(view);
  return view;
};

describe('emojiCompletionSource - trigger detection', () => {
  it('returns null when there is no ":xx" trigger and completion is not explicit', () => {
    expect(queryAt('', 0)).toBeNull();
    expect(queryAt('foo', 3)).toBeNull();
    // A single word character after ":" is below the two-character threshold.
    expect(queryAt(':s', 2)).toBeNull();
  });

  it('offers emoji options with ":tag:" labels once ":xx" precedes the cursor', () => {
    const result = queryAt(':sm', 3);

    expect(result).not.toBeNull();
    expect(result?.from).toBe(0);
    // Source offers the whole set; CodeMirror narrows via validFor/filtering.
    expect(result?.options.length).toBeGreaterThan(0);
    for (const option of result?.options ?? []) {
      expect(option.label).toMatch(/^:.+:$/);
    }
    // A well-known emoji tag is present in the offered set.
    expect(result?.options.map((o) => o.label)).toContain(':smile:');
  });

  it('exposes a validFor regex so CodeMirror can re-filter without re-invoking', () => {
    const result = queryAt(':sm', 3);

    expect(result?.validFor).toBeInstanceOf(RegExp);
  });
});

describe('emojiRenderOption', () => {
  it('renders the native emoji for a known completion.type into an HTMLElement', () => {
    const view = createView();
    const element = emojiRenderOption.render(
      { label: ':smile:', type: 'smile' },
      view.state,
      view,
    );

    expect(element).toBeInstanceOf(HTMLElement);
    // "smile" resolves to its native glyph.
    expect(element?.textContent).toBe('😄');
  });

  it('is inserted at position 20 (icon slot)', () => {
    expect(emojiRenderOption.position).toBe(20);
  });
});

describe('emojiAutocompletionSettings', () => {
  it('is still a defined Extension', () => {
    expect(emojiAutocompletionSettings).toBeTruthy();
  });
});
