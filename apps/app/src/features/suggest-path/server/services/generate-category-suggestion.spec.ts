import type { IUserHasId } from '@growi/core/dist/interfaces';

import {
  extractTopLevelSegment,
  generateCategoryDescription,
  generateCategorySuggestion,
} from './generate-category-suggestion';

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

describe('extractTopLevelSegment', () => {
  it('should extract top-level segment from nested path', () => {
    expect(extractTopLevelSegment('/tech-notes/React/hooks')).toBe(
      '/tech-notes/',
    );
  });

  it('should extract top-level segment from two-level path', () => {
    expect(extractTopLevelSegment('/tech-notes/React')).toBe('/tech-notes/');
  });

  it('should extract top-level segment from single-level path', () => {
    expect(extractTopLevelSegment('/tech-notes')).toBe('/tech-notes/');
  });

  it('should return root for root path', () => {
    expect(extractTopLevelSegment('/')).toBe('/');
  });
});

describe('generateCategoryDescription', () => {
  it('should generate description from segment name', () => {
    expect(generateCategoryDescription('tech-notes')).toBe(
      'Top-level category: tech-notes',
    );
  });

  it('should handle single word segment', () => {
    expect(generateCategoryDescription('guides')).toBe(
      'Top-level category: guides',
    );
  });
});

describe('generateCategorySuggestion', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveParentGrantMock.mockResolvedValue(GRANT_PUBLIC);
  });

  describe('when search returns results', () => {
    it('should return a suggestion with type "category"', async () => {
      const searchResult = createSearchResult([
        { path: '/tech-notes/React/hooks', score: 10 },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await generateCategorySuggestion(
        ['React', 'hooks'],
        mockUser,
        [],
        searchService,
      );

      expect(result).not.toBeNull();
      expect(result?.type).toBe('category');
    });

    it('should extract top-level segment from top result path', async () => {
      const searchResult = createSearchResult([
        { path: '/tech-notes/React/hooks', score: 10 },
        { path: '/guides/TypeScript/basics', score: 8 },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await generateCategorySuggestion(
        ['React'],
        mockUser,
        [],
        searchService,
      );

      expect(result?.path).toBe('/tech-notes/');
    });

    it('should return path with trailing slash', async () => {
      const searchResult = createSearchResult([
        { path: '/tech-notes/React/hooks', score: 10 },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await generateCategorySuggestion(
        ['React'],
        mockUser,
        [],
        searchService,
      );

      expect(result?.path).toMatch(/\/$/);
    });

    it('should extract top-level even from deeply nested path', async () => {
      const searchResult = createSearchResult([
        { path: '/guides/a/b/c/d', score: 10 },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await generateCategorySuggestion(
        ['keyword'],
        mockUser,
        [],
        searchService,
      );

      expect(result?.path).toBe('/guides/');
    });

    it('should generate description from top-level segment name', async () => {
      const searchResult = createSearchResult([
        { path: '/tech-notes/React/hooks', score: 10 },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await generateCategorySuggestion(
        ['React'],
        mockUser,
        [],
        searchService,
      );

      expect(result?.description).toBe('Top-level category: tech-notes');
    });

    it('should have label "Save under category"', async () => {
      const searchResult = createSearchResult([
        { path: '/tech-notes/React/hooks', score: 10 },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await generateCategorySuggestion(
        ['React'],
        mockUser,
        [],
        searchService,
      );

      expect(result?.label).toBe('Save under category');
    });

    it('should resolve grant from top-level directory', async () => {
      mocks.resolveParentGrantMock.mockResolvedValue(GRANT_PUBLIC);
      const searchResult = createSearchResult([
        { path: '/tech-notes/React/hooks', score: 10 },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await generateCategorySuggestion(
        ['React'],
        mockUser,
        [],
        searchService,
      );

      expect(mocks.resolveParentGrantMock).toHaveBeenCalledWith('/tech-notes/');
      expect(result?.grant).toBe(GRANT_PUBLIC);
    });

    it('should return GRANT_OWNER when parent page not found', async () => {
      mocks.resolveParentGrantMock.mockResolvedValue(GRANT_OWNER);
      const searchResult = createSearchResult([
        { path: '/nonexistent/page', score: 10 },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await generateCategorySuggestion(
        ['keyword'],
        mockUser,
        [],
        searchService,
      );

      expect(result?.grant).toBe(GRANT_OWNER);
    });

    it('should join keywords with spaces for search query', async () => {
      const searchResult = createSearchResult([
        { path: '/tech-notes/React/hooks', score: 10 },
      ]);
      const searchService = createMockSearchService(searchResult);

      await generateCategorySuggestion(
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

      await generateCategorySuggestion(
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

  describe('when top result is a single-segment page', () => {
    it('should return the page path as category', async () => {
      const searchResult = createSearchResult([
        { path: '/engineering', score: 10 },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await generateCategorySuggestion(
        ['keyword'],
        mockUser,
        [],
        searchService,
      );

      expect(result).not.toBeNull();
      expect(result?.path).toBe('/engineering/');
      expect(result?.description).toBe('Top-level category: engineering');
    });
  });

  describe('when search returns no results', () => {
    it('should return null', async () => {
      const searchResult = createSearchResult([]);
      const searchService = createMockSearchService(searchResult);

      const result = await generateCategorySuggestion(
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

      await generateCategorySuggestion(
        ['nonexistent'],
        mockUser,
        [],
        searchService,
      );

      expect(mocks.resolveParentGrantMock).not.toHaveBeenCalled();
    });
  });
});
