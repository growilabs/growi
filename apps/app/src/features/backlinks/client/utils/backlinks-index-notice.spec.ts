import type { IBacklinksIndexState } from '../../interfaces/backlink';
import {
  type BacklinksIndexNotice,
  toBacklinksIndexNotice,
} from './backlinks-index-notice';

const COVERED_SINCE = '2026-03-01T12:00:00.000Z';

describe('toBacklinksIndexNotice', () => {
  it.each<[string, IBacklinksIndexState | null, BacklinksIndexNotice]>([
    [
      'no notice when every page is covered',
      { coverage: 'all', coveredSince: null },
      null,
    ],
    [
      'partial, naming the boundary, for a partial index',
      { coverage: 'partial', coveredSince: COVERED_SINCE },
      { kind: 'partial', coveredSince: COVERED_SINCE },
    ],
    [
      'building for an index no run has covered',
      { coverage: 'none', coveredSince: null },
      { kind: 'building' },
    ],
    // A failed summary read is not evidence of a gap.
    ['no notice when the summary could not be read', null, null],
  ])('gives %s', (_label, indexState, expected) => {
    expect(toBacklinksIndexNotice(indexState)).toEqual(expected);
  });
});
