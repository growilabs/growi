import {
  mapToSearchResultItems,
  type SearchResultPageSource,
} from './search-result-mapper';

const SITE_URL = 'https://growi.example.com';

describe('mapToSearchResultItems', () => {
  it('maps rank, path, a title derived from the path, url, RFC 3339 UTC updatedAt, and commentCount', () => {
    const pages: readonly SearchResultPageSource[] = [
      {
        rank: 1,
        path: '/team/onboarding',
        updatedAt: new Date('2026-01-15T09:30:00.000Z'),
        commentCount: 3,
      },
    ];

    const result = mapToSearchResultItems(pages, SITE_URL);

    expect(result).toEqual([
      {
        rank: 1,
        path: '/team/onboarding',
        title: 'onboarding',
        url: 'https://growi.example.com/team/onboarding',
        updatedAt: '2026-01-15T09:30:00.000Z',
        commentCount: 3,
      },
    ]);
  });

  it('falls back to the full path as the title for the root page', () => {
    const pages: readonly SearchResultPageSource[] = [
      {
        rank: 1,
        path: '/',
        updatedAt: new Date('2026-01-15T00:00:00.000Z'),
        commentCount: 0,
      },
    ];

    const [item] = mapToSearchResultItems(pages, SITE_URL);

    expect(item.title).toBe('/');
  });

  it('preserves the input order and rank rather than re-sorting or renumbering', () => {
    const pages: readonly SearchResultPageSource[] = [
      { rank: 2, path: '/b', updatedAt: new Date(0), commentCount: 0 },
      { rank: 1, path: '/a', updatedAt: new Date(0), commentCount: 0 },
    ];

    const result = mapToSearchResultItems(pages, SITE_URL);

    expect(result.map((item) => item.rank)).toEqual([2, 1]);
    expect(result.map((item) => item.path)).toEqual(['/b', '/a']);
  });

  it('returns exactly the SearchResultItem fields, with no grant-shaped field leaking through', () => {
    // Regression guard: `SearchResultPageSource` declares no grant-related
    // field at all, so there is nothing to forward -- this asserts the
    // output's own key set stays exactly what @growi/chat's SearchResultItem
    // declares, in case a future edit widens the input type and blindly
    // spreads it into the output.
    const pages: readonly SearchResultPageSource[] = [
      {
        rank: 1,
        path: '/x',
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        commentCount: 0,
      },
    ];

    const [item] = mapToSearchResultItems(pages, SITE_URL);

    expect(Object.keys(item).sort()).toEqual(
      ['commentCount', 'path', 'rank', 'title', 'updatedAt', 'url'].sort(),
    );
  });

  it('maps an empty list to an empty list', () => {
    expect(mapToSearchResultItems([], SITE_URL)).toEqual([]);
  });
});
