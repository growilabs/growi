// @vitest-environment happy-dom

import { deleteCharBackward } from '@codemirror/commands';
import { EditorSelection, EditorState } from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';
import { EditorView } from '@codemirror/view';

import type { MentionData } from '../types';
import {
  addMention,
  mentionDecorationExtension,
  mentionDecorationField,
  mentionNavCallback,
} from './mention-decoration';

/**
 * Collect the [from, to] ranges held by the decoration field as plain tuples so
 * tests assert the observable range contract rather than DecorationSet internals.
 */
const decorationRanges = (deco: DecorationSet): Array<[number, number]> => {
  const ranges: Array<[number, number]> = [];
  const iter = deco.iter();
  while (iter.value != null) {
    ranges.push([iter.from, iter.to]);
    iter.next();
  }
  return ranges;
};

const fieldRanges = (state: EditorState): Array<[number, number]> =>
  decorationRanges(state.field(mentionDecorationField));

const buildState = (doc: string, caret: number = doc.length): EditorState =>
  EditorState.create({
    doc,
    selection: EditorSelection.cursor(caret),
    extensions: [mentionDecorationExtension],
  });

/**
 * Build a real EditorView in the DOM environment, attached to document.body so
 * that command behavior (selection/doc) reflects the installed extensions.
 */
const buildView = (state: EditorState): EditorView => {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new EditorView({ state, parent });
};

describe('mentionDecorationField + addMention (3.1 / 3.4)', () => {
  it('creates a replace-decoration over [from, to] when addMention is dispatched', () => {
    // doc: "/foo" occupies [0, 4]
    const state = buildState('/foo');
    const data: MentionData = { path: '/foo' };

    const next = state.update({
      effects: addMention.of({ from: 0, to: 4, data }),
    }).state;

    expect(fieldRanges(next)).toEqual([[0, 4]]);
  });

  it('starts with no decorations', () => {
    expect(fieldRanges(buildState('/foo'))).toEqual([]);
  });

  it('holds two independent decorations for two mentions (3.4)', () => {
    // doc: "/a x /b" → "/a" = [0,2], "/b" = [5,7]
    const state = buildState('/a x /b');

    const next = state.update({
      effects: [
        addMention.of({ from: 0, to: 2, data: { path: '/a' } }),
        addMention.of({ from: 5, to: 7, data: { path: '/b' } }),
      ],
    }).state;

    expect(fieldRanges(next)).toEqual([
      [0, 2],
      [5, 7],
    ]);
  });
});

describe('atomicRanges facet (3.3 / 5.3 proxy)', () => {
  it('exposes the mention range through EditorView.atomicRanges', () => {
    const view = buildView(buildState('/foo'));
    try {
      view.dispatch({
        effects: addMention.of({ from: 0, to: 4, data: { path: '/foo' } }),
      });

      const providers = view.state.facet(EditorView.atomicRanges);
      const ranges = providers.flatMap((provider) =>
        decorationRanges(provider(view)),
      );

      expect(ranges).toEqual([[0, 4]]);
    } finally {
      view.destroy();
    }
  });
});

describe('inclusive:false — adjacent insertion lands outside the decoration (5.4)', () => {
  it('does not extend the decoration when a char is inserted immediately after the mention', () => {
    const withMention = buildState('/foo').update({
      effects: addMention.of({ from: 0, to: 4, data: { path: '/foo' } }),
    }).state;

    // insert "x" at position 4 (immediately after the mention end)
    const next = withMention.update({
      changes: { from: 4, insert: 'x' },
    }).state;

    // The decoration range stays [0, 4]; the new char is outside it.
    expect(fieldRanges(next)).toEqual([[0, 4]]);
    expect(next.doc.toString()).toBe('/foox');
  });

  it('does not extend the decoration when a char is inserted immediately before the mention', () => {
    const withMention = buildState('/foo').update({
      effects: addMention.of({ from: 0, to: 4, data: { path: '/foo' } }),
    }).state;

    // insert "x" at position 0 (immediately before the mention start)
    const next = withMention.update({
      changes: { from: 0, insert: 'x' },
    }).state;

    // The mention shifts to [1, 5]; the inserted char is outside it.
    expect(fieldRanges(next)).toEqual([[1, 5]]);
    expect(next.doc.toString()).toBe('x/foo');
  });
});

describe('position follow via map (5.2)', () => {
  it('shifts the decoration range when text before it is edited, preserving the mention', () => {
    // doc: "ab /foo" → mention "/foo" at [3, 7]
    const withMention = buildState('ab /foo').update({
      effects: addMention.of({ from: 3, to: 7, data: { path: '/foo' } }),
    }).state;

    // insert "XYZ" at position 0 (before the mention)
    const next = withMention.update({
      changes: { from: 0, insert: 'XYZ' },
    }).state;

    // mention range shifts by +3 → [6, 10], still a single mention
    expect(fieldRanges(next)).toEqual([[6, 10]]);
    expect(next.doc.sliceString(6, 10)).toBe('/foo');
  });

  it('keeps two mentions independent when text between them is edited', () => {
    const withMentions = buildState('/a x /b').update({
      effects: [
        addMention.of({ from: 0, to: 2, data: { path: '/a' } }),
        addMention.of({ from: 5, to: 7, data: { path: '/b' } }),
      ],
    }).state;

    // insert "YY" at position 3 (between the two mentions)
    const next = withMentions.update({
      changes: { from: 3, insert: 'YY' },
    }).state;

    // first unchanged [0,2]; second shifts +2 → [7,9]
    expect(fieldRanges(next)).toEqual([
      [0, 2],
      [7, 9],
    ]);
  });
});

describe('command: deleteCharBackward removes the whole mention as one unit (5.1)', () => {
  it('removes the entire mention range in a single Backspace when caret is just after it', () => {
    const state = buildState('/foo').update({
      effects: addMention.of({ from: 0, to: 4, data: { path: '/foo' } }),
    }).state;

    const view = buildView(
      EditorState.create({
        doc: state.doc,
        selection: EditorSelection.cursor(4),
        extensions: [mentionDecorationExtension],
      }),
    );

    // re-register the decoration on the fresh view's state
    view.dispatch({
      effects: addMention.of({ from: 0, to: 4, data: { path: '/foo' } }),
    });
    view.dispatch({ selection: EditorSelection.cursor(4) });

    try {
      const handled = deleteCharBackward(view);

      expect(handled).toBe(true);
      // The whole "/foo" is gone in one step, not just the last char.
      expect(view.state.doc.toString()).toBe('');
      expect(fieldRanges(view.state)).toEqual([]);
    } finally {
      view.destroy();
    }
  });
});

describe('MentionWidget DOM (4.1 / 4.2)', () => {
  const renderWidgetDom = (
    data: MentionData,
    navCallback?: (data: MentionData) => void,
  ): { view: EditorView; dom: HTMLElement } => {
    const extensions = [mentionDecorationExtension];
    if (navCallback != null) {
      extensions.push(mentionNavCallback.of(navCallback));
    }
    const view = buildView(EditorState.create({ doc: '/foo', extensions }));
    view.dispatch({ effects: addMention.of({ from: 0, to: 4, data }) });

    // the rendered chip lives inside the editor content DOM
    const dom = view.contentDOM.querySelector<HTMLElement>('[data-mention]');
    if (dom == null) {
      throw new Error('mention chip DOM was not rendered');
    }
    return { view, dom };
  };

  it('renders the path via textContent (no HTML injection — 4.2/security)', () => {
    const data: MentionData = { path: '/foo<script>' };
    const { view, dom } = renderWidgetDom(data);
    try {
      expect(dom.textContent).toBe('/foo<script>');
      // no script element should have been parsed from the path
      expect(dom.querySelector('script')).toBeNull();
    } finally {
      view.destroy();
    }
  });

  it('invokes the NavCallback with the MentionData on click (4.1)', () => {
    const data: MentionData = { path: '/foo', pageId: 'p1' };
    const spy = vi.fn();
    const { view, dom } = renderWidgetDom(data, spy);
    try {
      dom.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(data);
    } finally {
      view.destroy();
    }
  });

  it('prevents the default on mousedown so the click is distinguished from caret movement (4.2)', () => {
    const { view, dom } = renderWidgetDom({ path: '/foo' });
    try {
      const ev = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
      });
      dom.dispatchEvent(ev);

      expect(ev.defaultPrevented).toBe(true);
    } finally {
      view.destroy();
    }
  });
});
