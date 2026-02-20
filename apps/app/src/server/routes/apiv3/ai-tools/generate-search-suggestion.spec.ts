import type { IUserHasId } from '@growi/core/dist/interfaces';

import {
  extractPageTitle,
  extractParentDirectory,
  generateSearchDescription,
  generateSearchSuggestion,
} from './generate-search-suggestion';

const mocks = vi.hoisted(() => {
  return {
    resolveParentGrantMock: vi.fn(),
  };
});

vi.mock('./resolve-parent-grant', () => ({
  resolveParentGrant: mocks.resolveParentGrantMock,
}));

const GRANT_PUBLIC = 1;
const GRANT_OWNER = 4;

function createSearchResult(pages: { path: string; score: number }[]) {
  return {
    data: pages.map((p) => ({
      _id: `id-${p.path}`,
      _score: p.score,
      _source: { path: p.path },
    })),
    meta: { total: pages.length, hitsCount: pages.length },
  };
}

function createMockSearchService(
  result: ReturnType<typeof createSearchResult>,
) {
  return {
    searchKeyword: vi.fn().mockResolvedValue([result, 'DEFAULT']),
  };
}

const mockUser = { _id: 'user1', username: 'alice' } as unknown as IUserHasId;

describe('extractParentDirectory', () => {
  it('should extract parent from nested path', () => {
    expect(extractParentDirectory('/tech-notes/React/hooks')).toBe(
      '/tech-notes/React/',
    );
  });

  it('should extract parent from two-level path', () => {
    expect(extractParentDirectory('/tech-notes/React')).toBe('/tech-notes/');
  });

  it('should return root for top-level page', () => {
    expect(extractParentDirectory('/top-level')).toBe('/');
  });

  it('should extract parent from deeply nested path', () => {
    expect(extractParentDirectory('/a/b/c/d')).toBe('/a/b/c/');
  });
});

describe('extractPageTitle', () => {
  it('should extract last segment as title', () => {
    expect(extractPageTitle('/tech-notes/React/hooks')).toBe('hooks');
  });

  it('should extract title from top-level page', () => {
    expect(extractPageTitle('/top-level')).toBe('top-level');
  });

  it('should return empty string for root path', () => {
    expect(extractPageTitle('/')).toBe('');
  });
});

describe('generateSearchDescription', () => {
  it('should list page titles', () => {
    expect(generateSearchDescription(['hooks', 'state', 'context'])).toBe(
      'Related pages under this directory: hooks, state, context',
    );
  });

  it('should handle single title', () => {
    expect(generateSearchDescription(['hooks'])).toBe(
      'Related pages under this directory: hooks',
    );
  });

  it('should return empty string for no titles', () => {
    expect(generateSearchDescription([])).toBe('');
  });
});

describe('generateSearchSuggestion', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveParentGrantMock.mockResolvedValue(GRANT_PUBLIC);
  });

  describe('when search returns results', () => {
    it('should return a suggestion with type "search"', async () => {
      const searchResult = createSearchResult([
        { path: '/tech-notes/React/hooks', score: 10 },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await generateSearchSuggestion(
        ['React', 'hooks'],
        mockUser,
        [],
        searchService,
      );

      expect(result).not.toBeNull();
      expect(result?.type).toBe('search');
    });

    it('should extract parent directory from top result path', async () => {
      const searchResult = createSearchResult([
        { path: '/tech-notes/React/hooks', score: 10 },
        { path: '/tech-notes/React/state', score: 8 },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await generateSearchSuggestion(
        ['React'],
        mockUser,
        [],
        searchService,
      );

      expect(result?.path).toBe('/tech-notes/React/');
    });

    it('should return path with trailing slash', async () => {
      const searchResult = createSearchResult([
        { path: '/tech-notes/React/hooks', score: 10 },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await generateSearchSuggestion(
        ['React'],
        mockUser,
        [],
        searchService,
      );

      expect(result?.path).toMatch(/\/$/);
    });

    it('should return root when page is at top level', async () => {
      const searchResult = createSearchResult([
        { path: '/top-level-page', score: 10 },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await generateSearchSuggestion(
        ['keyword'],
        mockUser,
        [],
        searchService,
      );

      expect(result?.path).toBe('/');
    });

    it('should include titles of up to 3 related pages in description', async () => {
      const searchResult = createSearchResult([
        { path: '/tech-notes/React/hooks', score: 10 },
        { path: '/tech-notes/React/state', score: 8 },
        { path: '/tech-notes/React/context', score: 6 },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await generateSearchSuggestion(
        ['React'],
        mockUser,
        [],
        searchService,
      );

      expect(result?.description).toBe(
        'Related pages under this directory: hooks, state, context',
      );
    });

    it('should include only 1 title when 1 result', async () => {
      const searchResult = createSearchResult([
        { path: '/tech-notes/React/hooks', score: 10 },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await generateSearchSuggestion(
        ['React'],
        mockUser,
        [],
        searchService,
      );

      expect(result?.description).toBe(
        'Related pages under this directory: hooks',
      );
    });

    it('should only include titles of pages under the parent directory', async () => {
      const searchResult = createSearchResult([
        { path: '/tech-notes/React/hooks', score: 10 },
        { path: '/guides/TypeScript/basics', score: 8 },
        { path: '/tech-notes/React/state', score: 6 },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await generateSearchSuggestion(
        ['React'],
        mockUser,
        [],
        searchService,
      );

      expect(result?.description).toBe(
        'Related pages under this directory: hooks, state',
      );
    });

    it('should limit description titles to 3 even when more pages match', async () => {
      const searchResult = createSearchResult([
        { path: '/tech-notes/React/hooks', score: 10 },
        { path: '/tech-notes/React/state', score: 9 },
        { path: '/tech-notes/React/context', score: 8 },
        { path: '/tech-notes/React/refs', score: 7 },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await generateSearchSuggestion(
        ['React'],
        mockUser,
        [],
        searchService,
      );

      expect(result?.description).toBe(
        'Related pages under this directory: hooks, state, context',
      );
    });

    it('should resolve grant from parent directory', async () => {
      mocks.resolveParentGrantMock.mockResolvedValue(GRANT_PUBLIC);
      const searchResult = createSearchResult([
        { path: '/tech-notes/React/hooks', score: 10 },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await generateSearchSuggestion(
        ['React'],
        mockUser,
        [],
        searchService,
      );

      expect(mocks.resolveParentGrantMock).toHaveBeenCalledWith(
        '/tech-notes/React/',
      );
      expect(result?.grant).toBe(GRANT_PUBLIC);
    });

    it('should return GRANT_OWNER when parent page not found', async () => {
      mocks.resolveParentGrantMock.mockResolvedValue(GRANT_OWNER);
      const searchResult = createSearchResult([
        { path: '/nonexistent/page', score: 10 },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await generateSearchSuggestion(
        ['keyword'],
        mockUser,
        [],
        searchService,
      );

      expect(result?.grant).toBe(GRANT_OWNER);
    });

    it('should have label "Save near related pages"', async () => {
      const searchResult = createSearchResult([
        { path: '/tech-notes/React/hooks', score: 10 },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await generateSearchSuggestion(
        ['React'],
        mockUser,
        [],
        searchService,
      );

      expect(result?.label).toBe('Save near related pages');
    });

    it('should join keywords with spaces for search query', async () => {
      const searchResult = createSearchResult([
        { path: '/tech-notes/React/hooks', score: 10 },
      ]);
      const searchService = createMockSearchService(searchResult);

      await generateSearchSuggestion(
        ['React', 'hooks', 'useState'],
        mockUser,
        [],
        searchService,
      );

      expect(searchService.searchKeyword).toHaveBeenCalledWith(
        'React hooks useState',
        null,
        mockUser,
        [],
        expect.objectContaining({ limit: expect.any(Number) }),
      );
    });

    it('should pass user and userGroups to searchKeyword', async () => {
      const searchResult = createSearchResult([
        { path: '/tech-notes/React/hooks', score: 10 },
      ]);
      const searchService = createMockSearchService(searchResult);
      const mockUserGroups = ['group1', 'group2'];

      await generateSearchSuggestion(
        ['React'],
        mockUser,
        mockUserGroups,
        searchService,
      );

      expect(searchService.searchKeyword).toHaveBeenCalledWith(
        expect.any(String),
        null,
        mockUser,
        mockUserGroups,
        expect.any(Object),
      );
    });
  });

  describe('when search returns no results', () => {
    it('should return null', async () => {
      const searchResult = createSearchResult([]);
      const searchService = createMockSearchService(searchResult);

      const result = await generateSearchSuggestion(
        ['nonexistent'],
        mockUser,
        [],
        searchService,
      );

      expect(result).toBeNull();
    });

    it('should not call resolveParentGrant', async () => {
      const searchResult = createSearchResult([]);
      const searchService = createMockSearchService(searchResult);

      await generateSearchSuggestion(
        ['nonexistent'],
        mockUser,
        [],
        searchService,
      );

      expect(mocks.resolveParentGrantMock).not.toHaveBeenCalled();
    });
  });
});
