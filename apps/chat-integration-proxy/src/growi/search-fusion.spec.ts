import type { SearchResultItem } from '@growi/chat';
import { describe, expect, it } from 'vitest';

import { fuseResults } from './search-fusion.js';

/**
 * `rank` is given explicitly on every fixture rather than derived from the
 * array position, because which of the two the formula reads is exactly what
 * the second test below pins down.
 */
const item = (rank: number, path: string): SearchResultItem => ({
  rank,
  path,
  title: path,
  url: `https://growi.example.com${path}`,
  updatedAt: '2026-09-01T00:00:00.000Z',
  commentCount: 0,
});

const pathsOf = (
  fused: ReadonlyArray<{ item: SearchResultItem }>,
): ReadonlyArray<string> => fused.map((entry) => entry.item.path);

describe('fuseResults: the weighted formula itself', () => {
  it('scores an item as weight / (k + rank), with k defaulting to 60', () => {
    const fused = fuseResults([
      {
        relationId: 'rel-a',
        growiLabel: 'A',
        weight: 2,
        items: [item(1, '/a1'), item(2, '/a2')],
      },
    ]);

    expect(fused).toEqual([
      {
        item: item(1, '/a1'),
        relationId: 'rel-a',
        growiLabel: 'A',
        score: 2 / 61,
      },
      {
        item: item(2, '/a2'),
        relationId: 'rel-a',
        growiLabel: 'A',
        score: 2 / 62,
      },
    ]);
  });

  it('reads the rank GROWI declared on the item, not the position in the array', () => {
    // Requirement 3.9 makes 順位 a field of its own precisely so that a
    // consumer reads it. The fixture deliberately disagrees with array
    // position: an implementation that re-derived rank from the index would
    // score `/third` highest here, because it arrives first.
    const fused = fuseResults([
      {
        relationId: 'rel-a',
        growiLabel: 'A',
        weight: 1,
        items: [item(3, '/third'), item(1, '/first'), item(2, '/second')],
      },
    ]);

    expect(pathsOf(fused)).toEqual(['/first', '/second', '/third']);
  });

  it('lets k be overridden, which flattens how far apart the ranks sit', () => {
    const [top, second] = fuseResults(
      [
        {
          relationId: 'rel-a',
          growiLabel: 'A',
          weight: 1,
          items: [item(1, '/a1'), item(2, '/a2')],
        },
      ],
      { k: 0 },
    );

    expect(top?.score).toBe(1 / 1);
    expect(second?.score).toBe(1 / 2);
  });
});

describe('fuseResults: merging several GROWIs', () => {
  const sourceA = {
    relationId: 'rel-a',
    growiLabel: 'A',
    items: [item(1, '/a1'), item(2, '/a2'), item(3, '/a3')],
  };
  const sourceB = {
    relationId: 'rel-b',
    growiLabel: 'B',
    items: [item(1, '/b1'), item(2, '/b2'), item(3, '/b3')],
  };

  it('coincides with a plain interleave when the weights are equal', () => {
    // design.md: 「GROWI ごとに文書集合が互いに素なので、重みが等しければ結果は
    // 交互配置と一致する」. Stated as a consequence of the formula, so it is
    // asserted rather than implemented as interleaving.
    const fused = fuseResults([
      { ...sourceA, weight: 1 },
      { ...sourceB, weight: 1 },
    ]);

    expect(pathsOf(fused)).toEqual(['/a1', '/b1', '/a2', '/b2', '/a3', '/b3']);
  });

  it('puts a heavier GROWI higher, changing the order the same inputs produced (Requirement 3.8)', () => {
    const fused = fuseResults([
      { ...sourceA, weight: 1 },
      { ...sourceB, weight: 3 },
    ]);

    // B's first three all outscore A's first: 3/61 > 3/62 > 3/63 > 1/61.
    expect(pathsOf(fused)).toEqual(['/b1', '/b2', '/b3', '/a1', '/a2', '/a3']);
  });

  it('keeps every result attributed to the GROWI it came from (Requirement 3.3)', () => {
    const fused = fuseResults([
      { ...sourceA, weight: 1 },
      { ...sourceB, weight: 1 },
    ]);

    expect(
      fused.map((entry) => [
        entry.item.path,
        entry.growiLabel,
        entry.relationId,
      ]),
    ).toEqual([
      ['/a1', 'A', 'rel-a'],
      ['/b1', 'B', 'rel-b'],
      ['/a2', 'A', 'rel-a'],
      ['/b2', 'B', 'rel-b'],
      ['/a3', 'A', 'rel-a'],
      ['/b3', 'B', 'rel-b'],
    ]);
  });

  it('truncates to `limit` after merging, not per GROWI', () => {
    const fused = fuseResults(
      [
        { ...sourceA, weight: 1 },
        { ...sourceB, weight: 3 },
      ],
      { limit: 4 },
    );

    expect(pathsOf(fused)).toEqual(['/b1', '/b2', '/b3', '/a1']);
  });

  it('answers with nothing when no GROWI contributed anything', () => {
    expect(fuseResults([])).toEqual([]);
    expect(
      fuseResults([
        { relationId: 'rel-a', growiLabel: 'A', weight: 1, items: [] },
      ]),
    ).toEqual([]);
  });
});
