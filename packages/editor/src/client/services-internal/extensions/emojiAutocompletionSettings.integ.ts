// @vitest-environment jsdom
import { autocompletion, startCompletion } from '@codemirror/autocomplete';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';

import { emojiAutocompletionSettings } from './emojiAutocompletionSettings';

// AC 4.1/4.3: the shared base owns icons:false and emoji adds only addToOptions.
// CodeMirror merges the two autocompletion() configs, so icons:false must survive
// (no default completion icon rendered). Observed via the rendered tooltip DOM,
// since the resolved config is not exposed by a public API.
describe('icons:false survives the shared-base + emoji config merge (integration)', () => {
  let view: EditorView | undefined;
  afterEach(() => {
    view?.destroy();
    view = undefined;
    document.body.innerHTML = '';
  });

  const renderedIconCount = async (icons: boolean): Promise<number> => {
    const dom = document.createElement('div');
    document.body.appendChild(dom);
    const doc = ':smi';
    view = new EditorView({
      parent: dom,
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor(doc.length),
        extensions: [
          markdown({ base: markdownLanguage }),
          autocompletion({ icons }), // shared base
          emojiAutocompletionSettings, // emoji adds autocompletion({ addToOptions }) — no icons key
        ],
      }),
    });
    startCompletion(view);
    await new Promise((r) => setTimeout(r, 50)); // let the completion tooltip render
    return document.querySelectorAll('.cm-completionIcon').length;
  };

  it('renders no default completion icon — icons:false from the shared base wins after merge', async () => {
    expect(await renderedIconCount(false)).toBe(0);
  });

  // Control: icons:true DOES render icons here, so the assertion above is failure-sensitive
  it('renders default completion icons when the shared base sets icons:true', async () => {
    expect(await renderedIconCount(true)).toBeGreaterThan(0);
  });
});
