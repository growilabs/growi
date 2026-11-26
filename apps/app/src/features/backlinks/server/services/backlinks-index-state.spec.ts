import type { IBacklinksIndexState } from '../../interfaces/backlink';
import {
  type BacklinksIndexJobRow,
  toBacklinksIndexState,
} from './backlinks-index-state';

const COVERED_SINCE = new Date('2026-03-01T12:00:00.000Z');

describe('toBacklinksIndexState', () => {
  it('reads a missing job document as not built', () => {
    expect(toBacklinksIndexState(null)).toEqual({
      coverage: 'none',
      coveredSince: null,
    });
  });

  it.each<[string, BacklinksIndexJobRow, IBacklinksIndexState]>([
    [
      'never run',
      { coverage: 'none', coveredSince: null },
      { coverage: 'none', coveredSince: null },
    ],
    [
      'partially covered',
      { coverage: 'partial', coveredSince: COVERED_SINCE },
      { coverage: 'partial', coveredSince: COVERED_SINCE.toISOString() },
    ],
    [
      'partial without its boundary (walked as none)',
      { coverage: 'partial', coveredSince: null },
      { coverage: 'none', coveredSince: null },
    ],
    [
      'covering every page',
      { coverage: 'all', coveredSince: null },
      { coverage: 'all', coveredSince: null },
    ],
  ])('summarizes a job %s', (_label, row, expected) => {
    expect(toBacklinksIndexState(row)).toEqual(expected);
  });
});
