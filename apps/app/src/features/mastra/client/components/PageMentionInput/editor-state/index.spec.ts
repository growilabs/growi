// @vitest-environment happy-dom

import { EditorState } from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';
import { EditorView } from '@codemirror/view';

import type { MentionController, MentionData } from '../types';
import { createPageMentionExtensions, mentionSessionField } from './index';
import {
  addMention,
  mentionDecorationField,
  mentionNavCallback,
} from './mention-decoration';
import { mentionControllerFacet } from './mention-keymap';

/** Build a real EditorView attached to the DOM so atomicRanges/updateListener run. */
const buildView = (state: EditorState): EditorView => {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new EditorView({ state, parent });
};

const decorationRanges = (deco: DecorationSet): Array<[number, number]> => {
  const ranges: Array<[number, number]> = [];
  const iter = deco.iter();
  while (iter.value != null) {
    ranges.push([iter.from, iter.to]);
    iter.next();
  }
  return ranges;
};

describe('createPageMentionExtensions — composed editor state (3.3)', () => {
  const buildState = (doc = ''): EditorState =>
    EditorState.create({
      doc,
      extensions: [
        createPageMentionExtensions({
          getController: () => null,
          onNavigate: vi.fn(),
        }),
      ],
    });

  it('installs the mention session StateField', () => {
    const state = buildState('@foo');
    expect(state.field(mentionSessionField)).toBeDefined();
  });

  it('installs the mention decoration StateField', () => {
    const state = buildState('/foo');
    expect(state.field(mentionDecorationField)).toBeDefined();
  });

  it('resolves the controller facet to the provided getter', () => {
    const controller: MentionController | null = null;
    const getController = (): MentionController | null => controller;
    const state = EditorState.create({
      extensions: [
        createPageMentionExtensions({ getController, onNavigate: vi.fn() }),
      ],
    });
    expect(state.facet(mentionControllerFacet)).toBe(getController);
  });

  it('registers the onNavigate handler in the nav-callback facet', () => {
    const onNavigate = vi.fn();
    const state = EditorState.create({
      extensions: [
        createPageMentionExtensions({
          getController: () => null,
          onNavigate,
        }),
      ],
    });
    expect(state.facet(mentionNavCallback)).toContain(onNavigate);
  });

  it('keeps atomicRanges active over a committed mention after composition (3.3)', () => {
    const view = buildView(buildState('/foo'));
    try {
      const data: MentionData = { path: '/foo' };
      view.dispatch({ effects: addMention.of({ from: 0, to: 4, data }) });

      const providers = view.state.facet(EditorView.atomicRanges);
      const ranges = providers.flatMap((provider) =>
        decorationRanges(provider(view)),
      );

      expect(ranges).toEqual([[0, 4]]);
    } finally {
      view.destroy();
    }
  });

  it('pushes the view to onSessionChange on each transaction (CM→React bridge)', () => {
    const onSessionChange = vi.fn();
    const view = buildView(
      EditorState.create({
        extensions: [
          createPageMentionExtensions({
            getController: () => null,
            onNavigate: vi.fn(),
            onSessionChange,
          }),
        ],
      }),
    );
    try {
      onSessionChange.mockClear();
      view.dispatch({ changes: { from: 0, insert: '@a' } });

      expect(onSessionChange).toHaveBeenCalled();
      expect(onSessionChange).toHaveBeenCalledWith(view);
    } finally {
      view.destroy();
    }
  });
});
