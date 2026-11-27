import type { RevisionMarkView } from '../../../interfaces';
import { buildRevisionMarkMap } from './build-revision-mark-map';

const mark = (
  revisionId: string,
  proposalId: string,
  isRevert = false,
): RevisionMarkView => ({ revisionId, proposalId, isRevert });

describe('buildRevisionMarkMap', () => {
  it('looks marks up by revision id', () => {
    const a = mark('rev-a', 'proposal-1');
    const b = mark('rev-b', 'proposal-2', true);

    const map = buildRevisionMarkMap([a, b]);

    expect(map.size).toBe(2);
    expect(map.get('rev-a')).toEqual(a);
    expect(map.get('rev-b')).toEqual(b);
  });

  it('returns an empty map for no marks', () => {
    expect(buildRevisionMarkMap([]).size).toBe(0);
  });

  it('returns undefined for a revision id that has no mark', () => {
    const map = buildRevisionMarkMap([mark('rev-a', 'proposal-1')]);

    expect(map.get('rev-unknown')).toBeUndefined();
  });

  it('does not mutate the input', () => {
    const marks = [mark('rev-a', 'proposal-1')];
    const snapshot = structuredClone(marks);

    buildRevisionMarkMap(marks);

    expect(marks).toEqual(snapshot);
  });
});
