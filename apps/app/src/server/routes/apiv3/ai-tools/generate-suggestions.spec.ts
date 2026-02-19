import type { IUserHasId } from '@growi/core/dist/interfaces';

import type { PathSuggestion } from './suggest-path-types';

const mocks = vi.hoisted(() => {
  return {
    generateMemoSuggestionMock: vi.fn(),
    generateSearchSuggestionMock: vi.fn(),
    generateCategorySuggestionMock: vi.fn(),
    loggerErrorMock: vi.fn(),
  };
});

vi.mock('./generate-memo-suggestion', () => ({
  generateMemoSuggestion: mocks.generateMemoSuggestionMock,
}));

vi.mock('./generate-search-suggestion', () => ({
  generateSearchSuggestion: mocks.generateSearchSuggestionMock,
}));

vi.mock('./generate-category-suggestion', () => ({
  generateCategorySuggestion: mocks.generateCategorySuggestionMock,
}));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    error: mocks.loggerErrorMock,
  }),
}));

const mockUser = {
  _id: 'user123',
  username: 'alice',
} as unknown as IUserHasId;

const mockUserGroups = ['group1', 'group2'];

const memoSuggestion: PathSuggestion = {
  type: 'memo',
  path: '/user/alice/memo/',
  label: 'Save as memo',
  description: 'Save to your personal memo area',
  grant: 4,
};

const searchSuggestion: PathSuggestion = {
  type: 'search',
  path: '/tech-notes/React/',
  label: 'Save near related pages',
  description: 'Related pages under this directory: hooks, state',
  grant: 1,
};

const categorySuggestion: PathSuggestion = {
  type: 'category',
  path: '/tech-notes/',
  label: 'Save under category',
  description: 'Top-level category: tech-notes',
  grant: 1,
};

describe('generateSuggestions', () => {
  const mockSearchService = {
    searchKeyword: vi.fn(),
  };

  const mockExtractKeywords = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.generateMemoSuggestionMock.mockResolvedValue(memoSuggestion);
  });

  const callGenerateSuggestions = async () => {
    const { generateSuggestions } = await import('./generate-suggestions');
    return generateSuggestions(mockUser, 'Some page content', mockUserGroups, {
      searchService: mockSearchService,
      extractKeywords: mockExtractKeywords,
    });
  };

  describe('successful multi-suggestion response', () => {
    it('should return memo, search, and category suggestions when all succeed', async () => {
      mockExtractKeywords.mockResolvedValue(['React', 'hooks']);
      mocks.generateSearchSuggestionMock.mockResolvedValue(searchSuggestion);
      mocks.generateCategorySuggestionMock.mockResolvedValue(
        categorySuggestion,
      );

      const result = await callGenerateSuggestions();

      expect(result).toEqual([
        memoSuggestion,
        searchSuggestion,
        categorySuggestion,
      ]);
    });

    it('should always include memo as the first suggestion', async () => {
      mockExtractKeywords.mockResolvedValue(['React', 'hooks']);
      mocks.generateSearchSuggestionMock.mockResolvedValue(searchSuggestion);
      mocks.generateCategorySuggestionMock.mockResolvedValue(
        categorySuggestion,
      );

      const result = await callGenerateSuggestions();

      expect(result[0]).toEqual(memoSuggestion);
    });

    it('should pass keywords, user, userGroups, and searchService to search generator', async () => {
      mockExtractKeywords.mockResolvedValue(['React', 'hooks']);
      mocks.generateSearchSuggestionMock.mockResolvedValue(null);
      mocks.generateCategorySuggestionMock.mockResolvedValue(null);

      await callGenerateSuggestions();

      expect(mocks.generateSearchSuggestionMock).toHaveBeenCalledWith(
        ['React', 'hooks'],
        mockUser,
        mockUserGroups,
        mockSearchService,
      );
    });

    it('should pass keywords, user, userGroups, and searchService to category generator', async () => {
      mockExtractKeywords.mockResolvedValue(['React', 'hooks']);
      mocks.generateSearchSuggestionMock.mockResolvedValue(null);
      mocks.generateCategorySuggestionMock.mockResolvedValue(null);

      await callGenerateSuggestions();

      expect(mocks.generateCategorySuggestionMock).toHaveBeenCalledWith(
        ['React', 'hooks'],
        mockUser,
        mockUserGroups,
        mockSearchService,
      );
    });
  });

  describe('partial results', () => {
    it('should omit search suggestion when search returns null', async () => {
      mockExtractKeywords.mockResolvedValue(['React', 'hooks']);
      mocks.generateSearchSuggestionMock.mockResolvedValue(null);
      mocks.generateCategorySuggestionMock.mockResolvedValue(
        categorySuggestion,
      );

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion, categorySuggestion]);
    });

    it('should omit category suggestion when category returns null', async () => {
      mockExtractKeywords.mockResolvedValue(['React', 'hooks']);
      mocks.generateSearchSuggestionMock.mockResolvedValue(searchSuggestion);
      mocks.generateCategorySuggestionMock.mockResolvedValue(null);

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion, searchSuggestion]);
    });

    it('should return memo only when both search and category return null', async () => {
      mockExtractKeywords.mockResolvedValue(['React', 'hooks']);
      mocks.generateSearchSuggestionMock.mockResolvedValue(null);
      mocks.generateCategorySuggestionMock.mockResolvedValue(null);

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion]);
    });
  });

  describe('graceful degradation', () => {
    it('should fall back to memo only when keyword extraction fails', async () => {
      mockExtractKeywords.mockRejectedValue(
        new Error('AI service unavailable'),
      );

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion]);
      expect(mocks.generateSearchSuggestionMock).not.toHaveBeenCalled();
      expect(mocks.generateCategorySuggestionMock).not.toHaveBeenCalled();
    });

    it('should log error when keyword extraction fails', async () => {
      const error = new Error('AI service unavailable');
      mockExtractKeywords.mockRejectedValue(error);

      await callGenerateSuggestions();

      expect(mocks.loggerErrorMock).toHaveBeenCalled();
    });

    it('should fall back to memo only when keyword extraction returns empty array', async () => {
      mockExtractKeywords.mockResolvedValue([]);

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion]);
      expect(mocks.generateSearchSuggestionMock).not.toHaveBeenCalled();
      expect(mocks.generateCategorySuggestionMock).not.toHaveBeenCalled();
    });

    it('should fall back to memo only when search generator throws', async () => {
      mockExtractKeywords.mockResolvedValue(['React', 'hooks']);
      mocks.generateSearchSuggestionMock.mockRejectedValue(
        new Error('Search service down'),
      );
      mocks.generateCategorySuggestionMock.mockResolvedValue(
        categorySuggestion,
      );

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion]);
    });

    it('should fall back to memo only when category generator throws', async () => {
      mockExtractKeywords.mockResolvedValue(['React', 'hooks']);
      mocks.generateSearchSuggestionMock.mockResolvedValue(searchSuggestion);
      mocks.generateCategorySuggestionMock.mockRejectedValue(
        new Error('Category generation failed'),
      );

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion]);
    });

    it('should log error when search or category generator throws', async () => {
      mockExtractKeywords.mockResolvedValue(['React', 'hooks']);
      mocks.generateSearchSuggestionMock.mockRejectedValue(
        new Error('Search service down'),
      );
      mocks.generateCategorySuggestionMock.mockResolvedValue(null);

      await callGenerateSuggestions();

      expect(mocks.loggerErrorMock).toHaveBeenCalled();
    });
  });
});
