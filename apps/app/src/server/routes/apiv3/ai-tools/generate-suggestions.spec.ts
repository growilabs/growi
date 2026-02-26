import type { IUserHasId } from '@growi/core/dist/interfaces';

import type {
  ContentAnalysis,
  EvaluatedSuggestion,
  PathSuggestion,
  SearchCandidate,
} from './suggest-path-types';

const mocks = vi.hoisted(() => {
  return {
    generateMemoSuggestionMock: vi.fn(),
    loggerErrorMock: vi.fn(),
  };
});

vi.mock('./generate-memo-suggestion', () => ({
  generateMemoSuggestion: mocks.generateMemoSuggestionMock,
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

const mockAnalysis: ContentAnalysis = {
  keywords: ['React', 'hooks'],
  informationType: 'stock',
};

const mockCandidates: SearchCandidate[] = [
  {
    pagePath: '/tech/React/hooks',
    snippet: 'React hooks overview',
    score: 10.5,
  },
  { pagePath: '/tech/React/state', snippet: 'State management', score: 8.2 },
];

const mockEvaluated: EvaluatedSuggestion[] = [
  {
    path: '/tech/React/',
    label: 'Save near related pages',
    description:
      'This area contains React documentation. Your stock content fits well here.',
  },
  {
    path: '/tech/React/performance/',
    label: 'New section for performance topics',
    description: 'A new sibling section alongside existing React pages.',
  },
];

const categorySuggestion: PathSuggestion = {
  type: 'category',
  path: '/tech/',
  label: 'Save under category',
  description: 'Top-level category: tech',
  grant: 1,
};

describe('generateSuggestions', () => {
  const createMockDeps = () => ({
    analyzeContent: vi.fn<(body: string) => Promise<ContentAnalysis>>(),
    retrieveSearchCandidates:
      vi.fn<
        (
          keywords: string[],
          user: IUserHasId,
          userGroups: unknown,
        ) => Promise<SearchCandidate[]>
      >(),
    evaluateCandidates:
      vi.fn<
        (
          body: string,
          analysis: ContentAnalysis,
          candidates: SearchCandidate[],
        ) => Promise<EvaluatedSuggestion[]>
      >(),
    generateCategorySuggestion:
      vi.fn<
        (
          keywords: string[],
          user: IUserHasId,
          userGroups: unknown,
        ) => Promise<PathSuggestion | null>
      >(),
    resolveParentGrant: vi.fn<(path: string) => Promise<number>>(),
  });

  let mockDeps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.generateMemoSuggestionMock.mockResolvedValue(memoSuggestion);
    mockDeps = createMockDeps();
  });

  const callGenerateSuggestions = async () => {
    const { generateSuggestions } = await import('./generate-suggestions');
    return generateSuggestions(
      mockUser,
      'Some page content',
      mockUserGroups,
      mockDeps,
    );
  };

  describe('successful full pipeline', () => {
    beforeEach(() => {
      mockDeps.analyzeContent.mockResolvedValue(mockAnalysis);
      mockDeps.retrieveSearchCandidates.mockResolvedValue(mockCandidates);
      mockDeps.evaluateCandidates.mockResolvedValue(mockEvaluated);
      mockDeps.generateCategorySuggestion.mockResolvedValue(categorySuggestion);
      mockDeps.resolveParentGrant.mockResolvedValue(1);
    });

    it('should return memo + search + category suggestions when all succeed', async () => {
      const result = await callGenerateSuggestions();

      expect(result).toHaveLength(4); // memo + 2 search + 1 category
      expect(result[0]).toEqual(memoSuggestion);
      expect(result[1]).toMatchObject({ type: 'search', path: '/tech/React/' });
      expect(result[2]).toMatchObject({
        type: 'search',
        path: '/tech/React/performance/',
      });
      expect(result[3]).toEqual(categorySuggestion);
    });

    it('should always include memo as the first suggestion', async () => {
      const result = await callGenerateSuggestions();

      expect(result[0]).toEqual(memoSuggestion);
    });

    it('should map informationType from content analysis to search-type suggestions', async () => {
      const result = await callGenerateSuggestions();

      const searchSuggestions = result.filter((s) => s.type === 'search');
      for (const s of searchSuggestions) {
        expect(s.informationType).toBe('stock');
      }
    });

    it('should not include informationType on memo or category suggestions', async () => {
      const result = await callGenerateSuggestions();

      expect(result[0].informationType).toBeUndefined(); // memo
      expect(result[3].informationType).toBeUndefined(); // category
    });

    it('should resolve grant for each evaluated suggestion path', async () => {
      mockDeps.resolveParentGrant
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(4);

      const result = await callGenerateSuggestions();

      expect(mockDeps.resolveParentGrant).toHaveBeenCalledTimes(2);
      expect(mockDeps.resolveParentGrant).toHaveBeenCalledWith('/tech/React/');
      expect(mockDeps.resolveParentGrant).toHaveBeenCalledWith(
        '/tech/React/performance/',
      );
      expect(result[1].grant).toBe(1);
      expect(result[2].grant).toBe(4);
    });

    it('should pass correct arguments to analyzeContent', async () => {
      await callGenerateSuggestions();

      expect(mockDeps.analyzeContent).toHaveBeenCalledWith('Some page content');
    });

    it('should pass keywords from content analysis to retrieveSearchCandidates', async () => {
      await callGenerateSuggestions();

      expect(mockDeps.retrieveSearchCandidates).toHaveBeenCalledWith(
        ['React', 'hooks'],
        mockUser,
        mockUserGroups,
      );
    });

    it('should pass body, analysis, and candidates to evaluateCandidates', async () => {
      await callGenerateSuggestions();

      expect(mockDeps.evaluateCandidates).toHaveBeenCalledWith(
        'Some page content',
        mockAnalysis,
        mockCandidates,
      );
    });

    it('should pass keywords from content analysis to generateCategorySuggestion', async () => {
      await callGenerateSuggestions();

      expect(mockDeps.generateCategorySuggestion).toHaveBeenCalledWith(
        ['React', 'hooks'],
        mockUser,
        mockUserGroups,
      );
    });
  });

  describe('graceful degradation', () => {
    it('should fall back to memo only when content analysis fails', async () => {
      mockDeps.analyzeContent.mockRejectedValue(
        new Error('AI service unavailable'),
      );

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion]);
      expect(mockDeps.retrieveSearchCandidates).not.toHaveBeenCalled();
      expect(mockDeps.evaluateCandidates).not.toHaveBeenCalled();
      expect(mockDeps.generateCategorySuggestion).not.toHaveBeenCalled();
    });

    it('should log error when content analysis fails', async () => {
      mockDeps.analyzeContent.mockRejectedValue(
        new Error('AI service unavailable'),
      );

      await callGenerateSuggestions();

      expect(mocks.loggerErrorMock).toHaveBeenCalled();
    });

    it('should return memo + category when search candidate retrieval fails', async () => {
      mockDeps.analyzeContent.mockResolvedValue(mockAnalysis);
      mockDeps.retrieveSearchCandidates.mockRejectedValue(
        new Error('Search service down'),
      );
      mockDeps.generateCategorySuggestion.mockResolvedValue(categorySuggestion);

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion, categorySuggestion]);
      expect(mocks.loggerErrorMock).toHaveBeenCalled();
    });

    it('should return memo + category when candidate evaluation fails', async () => {
      mockDeps.analyzeContent.mockResolvedValue(mockAnalysis);
      mockDeps.retrieveSearchCandidates.mockResolvedValue(mockCandidates);
      mockDeps.evaluateCandidates.mockRejectedValue(
        new Error('AI evaluation failed'),
      );
      mockDeps.generateCategorySuggestion.mockResolvedValue(categorySuggestion);

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion, categorySuggestion]);
      expect(mocks.loggerErrorMock).toHaveBeenCalled();
    });

    it('should return memo + search when category generation fails', async () => {
      mockDeps.analyzeContent.mockResolvedValue(mockAnalysis);
      mockDeps.retrieveSearchCandidates.mockResolvedValue(mockCandidates);
      mockDeps.evaluateCandidates.mockResolvedValue(mockEvaluated);
      mockDeps.resolveParentGrant.mockResolvedValue(1);
      mockDeps.generateCategorySuggestion.mockRejectedValue(
        new Error('Category failed'),
      );

      const result = await callGenerateSuggestions();

      expect(result).toHaveLength(3); // memo + 2 search (no category)
      expect(result[0]).toEqual(memoSuggestion);
      expect(result[1]).toMatchObject({ type: 'search' });
      expect(result[2]).toMatchObject({ type: 'search' });
      expect(mocks.loggerErrorMock).toHaveBeenCalled();
    });

    it('should return memo only when both search pipeline and category fail', async () => {
      mockDeps.analyzeContent.mockResolvedValue(mockAnalysis);
      mockDeps.retrieveSearchCandidates.mockRejectedValue(
        new Error('Search down'),
      );
      mockDeps.generateCategorySuggestion.mockRejectedValue(
        new Error('Category failed'),
      );

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion]);
    });

    it('should skip search suggestions when no candidates pass threshold (empty array)', async () => {
      mockDeps.analyzeContent.mockResolvedValue(mockAnalysis);
      mockDeps.retrieveSearchCandidates.mockResolvedValue([]);
      mockDeps.generateCategorySuggestion.mockResolvedValue(categorySuggestion);

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion, categorySuggestion]);
      expect(mockDeps.evaluateCandidates).not.toHaveBeenCalled();
    });

    it('should omit category when generateCategorySuggestion returns null', async () => {
      mockDeps.analyzeContent.mockResolvedValue(mockAnalysis);
      mockDeps.retrieveSearchCandidates.mockResolvedValue(mockCandidates);
      mockDeps.evaluateCandidates.mockResolvedValue(mockEvaluated);
      mockDeps.resolveParentGrant.mockResolvedValue(1);
      mockDeps.generateCategorySuggestion.mockResolvedValue(null);

      const result = await callGenerateSuggestions();

      expect(result).toHaveLength(3); // memo + 2 search, no category
      expect(result.every((s) => s.type !== 'category')).toBe(true);
    });
  });

  describe('informationType mapping', () => {
    it('should map flow informationType to search-type suggestions', async () => {
      const flowAnalysis: ContentAnalysis = {
        keywords: ['meeting', 'minutes'],
        informationType: 'flow',
      };
      mockDeps.analyzeContent.mockResolvedValue(flowAnalysis);
      mockDeps.retrieveSearchCandidates.mockResolvedValue(mockCandidates);
      mockDeps.evaluateCandidates.mockResolvedValue([mockEvaluated[0]]);
      mockDeps.resolveParentGrant.mockResolvedValue(1);
      mockDeps.generateCategorySuggestion.mockResolvedValue(null);

      const result = await callGenerateSuggestions();

      const searchSuggestion = result.find((s) => s.type === 'search');
      expect(searchSuggestion?.informationType).toBe('flow');
    });
  });

  describe('parallel execution', () => {
    it('should run search-evaluate pipeline and category generation independently', async () => {
      mockDeps.analyzeContent.mockResolvedValue(mockAnalysis);
      mockDeps.retrieveSearchCandidates.mockRejectedValue(
        new Error('Search down'),
      );
      mockDeps.generateCategorySuggestion.mockResolvedValue(categorySuggestion);

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion, categorySuggestion]);
    });

    it('should return search suggestions even when category fails', async () => {
      mockDeps.analyzeContent.mockResolvedValue(mockAnalysis);
      mockDeps.retrieveSearchCandidates.mockResolvedValue(mockCandidates);
      mockDeps.evaluateCandidates.mockResolvedValue(mockEvaluated);
      mockDeps.resolveParentGrant.mockResolvedValue(1);
      mockDeps.generateCategorySuggestion.mockRejectedValue(
        new Error('Category failed'),
      );

      const result = await callGenerateSuggestions();

      const searchSuggestions = result.filter((s) => s.type === 'search');
      expect(searchSuggestions).toHaveLength(2);
    });
  });
});
