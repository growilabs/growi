import type { StateEffect } from '@codemirror/state';
import { EditorSelection, EditorState } from '@codemirror/state';

import type { MentionData } from '../types';
import { getMentionFlattenedText } from './flatten';
import { addMention, mentionDecorationExtension } from './mention-decoration';

/**
 * Build a state whose doc holds the mention path strings literally (the doc is
 * the source of truth) and register a replace-decoration over each so the state
 * mirrors what the editor produces at runtime. The flattened text must reflect
 * the raw doc, unaffected by the chip decorations.
 */
const buildStateWithMentions = (
  segments: ReadonlyArray<string | MentionData>,
): EditorState => {
  const doc = segments
    .map((s) => (typeof s === 'string' ? s : s.path))
    .join('');

  let state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(doc.length),
    extensions: [mentionDecorationExtension],
  });

  let pos = 0;
  const effects: StateEffect<{
    from: number;
    to: number;
    data: MentionData;
  }>[] = [];
  for (const seg of segments) {
    const text = typeof seg === 'string' ? seg : seg.path;
    if (typeof seg !== 'string') {
      effects.push(
        addMention.of({ from: pos, to: pos + text.length, data: seg }),
      );
    }
    pos += text.length;
  }
  state = state.update({ effects }).state;

  return state;
};

describe('getMentionFlattenedText', () => {
  it('returns multiple mention paths inline at their positions and in order (6.1, 6.3)', () => {
    const a: MentionData = { path: '/docs/alpha', pageId: 'p1' };
    const b: MentionData = { path: '/team/beta', pageId: 'p2' };
    const state = buildStateWithMentions([
      'see ',
      a,
      ' and also ',
      b,
      ' please',
    ]);

    const result = getMentionFlattenedText(state);

    expect(result).toBe('see /docs/alpha and also /team/beta please');
    // Order is preserved: alpha precedes beta.
    expect(result.indexOf('/docs/alpha')).toBeLessThan(
      result.indexOf('/team/beta'),
    );
  });

  it('contains only the doc text — no page body or injected content (6.2)', () => {
    const a: MentionData = { path: '/docs/alpha', pageId: 'p1' };
    const state = buildStateWithMentions(['hi ', a]);

    const result = getMentionFlattenedText(state);

    // Exactly the doc; nothing beyond the path string is added.
    expect(result).toBe('hi /docs/alpha');
    expect(result).toBe(state.doc.toString());
  });

  it('is unaffected by mention chip decorations — paths remain plain doc text', () => {
    const a: MentionData = { path: '/docs/alpha', pageId: 'p1' };

    const withDecoration = buildStateWithMentions([a]);
    const plainDoc = EditorState.create({ doc: '/docs/alpha' });

    expect(getMentionFlattenedText(withDecoration)).toBe(
      getMentionFlattenedText(plainDoc),
    );
  });

  it('returns an empty string for an empty doc', () => {
    const state = EditorState.create({ doc: '' });

    expect(getMentionFlattenedText(state)).toBe('');
  });

  it('returns plain text verbatim when there are no mentions', () => {
    const state = EditorState.create({ doc: 'just a normal message' });

    expect(getMentionFlattenedText(state)).toBe('just a normal message');
  });
});
