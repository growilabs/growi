import type { IUserHasId } from '@growi/core/dist/interfaces';
import { mock } from 'vitest-mock-extended';

import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';

import type {
  ContentAnalysis,
  EvaluatedSuggestion,
  PathSuggestion,
  SearchCandidate,
  SearchService,
} from '../../interfaces/suggest-path-types';

const mocks = vi.hoisted(() => {
  return {
    generateMemoSuggestionMock: vi.fn(),
    analyzeContentMock: vi.fn(),
    retrieveSearchCandidatesMock: vi.fn(),
    evaluateCandidatesMock: vi.fn(),
    generateCategorySuggestionMock: vi.fn(),
    resolveParentGrantMock: vi.fn(),
    agenticEngineMock: vi.fn(),
    isAiConfiguredMock: vi.fn(),
    loggerErrorMock: vi.fn(),
    loggerInfoMock: vi.fn(),
  };
});

vi.mock('./generate-memo-suggestion', () => ({
  generateMemoSuggestion: mocks.generateMemoSuggestionMock,
}));

vi.mock('./analyze-content', () => ({
  analyzeContent: mocks.analyzeContentMock,
}));

vi.mock('./retrieve-search-candidates', () => ({
  retrieveSearchCandidates: mocks.retrieveSearchCandidatesMock,
}));

vi.mock('./evaluate-candidates', () => ({
  evaluateCandidates: mocks.evaluateCandidatesMock,
}));

vi.mock('./generate-category-suggestion', () => ({
  generateCategorySuggestion: mocks.generateCategorySuggestionMock,
}));

vi.mock('./resolve-parent-grant', () => ({
  resolveParentGrant: mocks.resolveParentGrantMock,
}));

// The engine selection statically imports the agentic engine, whose
// transitive imports (mastra-modules) cannot load in the unit-test process
// (module-scope config reads, ESM/CJS interop). Stubbing it keeps the real
// selection + real oneshot engine in the graph, which these tests exercise.
vi.mock('./engines/agentic-engine', () => ({
  agenticEngine: mocks.agenticEngineMock,
}));

// Availability signal for the engine selection: primed to false in
// beforeEach so the tests exercise the oneshot path, overridden per test to
// exercise the agentic path.
vi.mock('~/features/mastra/server/services/is-ai-configured', () => ({
  isAiConfigured: mocks.isAiConfiguredMock,
}));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    error: mocks.loggerErrorMock,
    info: mocks.loggerInfoMock,
  }),
}));

const mockUser = mock<IUserHasId>({ _id: 'user123', username: 'alice' });

const mockUserGroups: ObjectIdLike[] = ['group1', 'group2'];

const mockSearchService = mock<SearchService>({ isReachable: true });

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
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.generateMemoSuggestionMock.mockResolvedValue(memoSuggestion);
    // Mastra AI unconfigured -> the selection falls back to the oneshot
    // engine (mockSearchService declares isReachable: true).
    mocks.isAiConfiguredMock.mockReturnValue(false);
  });

  const callGenerateSuggestions = async () => {
    const { generateSuggestions } = await import('./generate-suggestions');
    return generateSuggestions(
      mockUser,
      'Some page content',
      mockUserGroups,
      mockSearchService,
    );
  };

  describe('successful full pipeline', () => {
    beforeEach(() => {
      mocks.analyzeContentMock.mockResolvedValue(mockAnalysis);
      mocks.retrieveSearchCandidatesMock.mockResolvedValue(mockCandidates);
      mocks.evaluateCandidatesMock.mockResolvedValue(mockEvaluated);
      mocks.generateCategorySuggestionMock.mockResolvedValue(
        categorySuggestion,
      );
      mocks.resolveParentGrantMock.mockResolvedValue(1);
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
      mocks.resolveParentGrantMock
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(4);

      const result = await callGenerateSuggestions();

      expect(mocks.resolveParentGrantMock).toHaveBeenCalledTimes(2);
      expect(mocks.resolveParentGrantMock).toHaveBeenCalledWith('/tech/React/');
      expect(mocks.resolveParentGrantMock).toHaveBeenCalledWith(
        '/tech/React/performance/',
      );
      expect(result[1].grant).toBe(1);
      expect(result[2].grant).toBe(4);
    });

    it('should pass correct arguments to analyzeContent', async () => {
      await callGenerateSuggestions();

      expect(mocks.analyzeContentMock).toHaveBeenCalledWith(
        'Some page content',
      );
    });

    it('should pass keywords, user, userGroups, and searchService to retrieveSearchCandidates', async () => {
      await callGenerateSuggestions();

      expect(mocks.retrieveSearchCandidatesMock).toHaveBeenCalledWith(
        ['React', 'hooks'],
        mockUser,
        mockUserGroups,
        mockSearchService,
      );
    });

    it('should pass body, analysis, and candidates to evaluateCandidates', async () => {
      await callGenerateSuggestions();

      expect(mocks.evaluateCandidatesMock).toHaveBeenCalledWith(
        'Some page content',
        mockAnalysis,
        mockCandidates,
      );
    });

    it('should pass candidates to generateCategorySuggestion', async () => {
      await callGenerateSuggestions();

      expect(mocks.generateCategorySuggestionMock).toHaveBeenCalledWith(
        mockCandidates,
      );
    });
  });

  describe('graceful degradation', () => {
    it('should fall back to memo only when content analysis fails', async () => {
      mocks.analyzeContentMock.mockRejectedValue(
        new Error('AI service unavailable'),
      );

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion]);
      expect(mocks.retrieveSearchCandidatesMock).not.toHaveBeenCalled();
      expect(mocks.evaluateCandidatesMock).not.toHaveBeenCalled();
      expect(mocks.generateCategorySuggestionMock).not.toHaveBeenCalled();
    });

    it('should log error when content analysis fails', async () => {
      mocks.analyzeContentMock.mockRejectedValue(
        new Error('AI service unavailable'),
      );

      await callGenerateSuggestions();

      expect(mocks.loggerErrorMock).toHaveBeenCalled();
    });

    it('should fall back to memo only when search candidate retrieval fails', async () => {
      mocks.analyzeContentMock.mockResolvedValue(mockAnalysis);
      mocks.retrieveSearchCandidatesMock.mockRejectedValue(
        new Error('Search service down'),
      );

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion]);
      expect(mocks.loggerErrorMock).toHaveBeenCalled();
    });

    it('should return memo + category when candidate evaluation fails', async () => {
      mocks.analyzeContentMock.mockResolvedValue(mockAnalysis);
      mocks.retrieveSearchCandidatesMock.mockResolvedValue(mockCandidates);
      mocks.evaluateCandidatesMock.mockRejectedValue(
        new Error('AI evaluation failed'),
      );
      mocks.generateCategorySuggestionMock.mockResolvedValue(
        categorySuggestion,
      );

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion, categorySuggestion]);
      expect(mocks.loggerErrorMock).toHaveBeenCalled();
    });

    it('should return memo + search when category generation fails', async () => {
      mocks.analyzeContentMock.mockResolvedValue(mockAnalysis);
      mocks.retrieveSearchCandidatesMock.mockResolvedValue(mockCandidates);
      mocks.evaluateCandidatesMock.mockResolvedValue(mockEvaluated);
      mocks.resolveParentGrantMock.mockResolvedValue(1);
      mocks.generateCategorySuggestionMock.mockRejectedValue(
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
      mocks.analyzeContentMock.mockResolvedValue(mockAnalysis);
      mocks.retrieveSearchCandidatesMock.mockRejectedValue(
        new Error('Search down'),
      );

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion]);
    });

    it('should skip search suggestions when no candidates pass threshold (empty array)', async () => {
      mocks.analyzeContentMock.mockResolvedValue(mockAnalysis);
      mocks.retrieveSearchCandidatesMock.mockResolvedValue([]);
      mocks.generateCategorySuggestionMock.mockResolvedValue(null);

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion]);
      expect(mocks.evaluateCandidatesMock).not.toHaveBeenCalled();
    });

    it('should omit category when generateCategorySuggestion returns null', async () => {
      mocks.analyzeContentMock.mockResolvedValue(mockAnalysis);
      mocks.retrieveSearchCandidatesMock.mockResolvedValue(mockCandidates);
      mocks.evaluateCandidatesMock.mockResolvedValue(mockEvaluated);
      mocks.resolveParentGrantMock.mockResolvedValue(1);
      mocks.generateCategorySuggestionMock.mockResolvedValue(null);

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
      mocks.analyzeContentMock.mockResolvedValue(flowAnalysis);
      mocks.retrieveSearchCandidatesMock.mockResolvedValue(mockCandidates);
      mocks.evaluateCandidatesMock.mockResolvedValue([mockEvaluated[0]]);
      mocks.resolveParentGrantMock.mockResolvedValue(1);
      mocks.generateCategorySuggestionMock.mockResolvedValue(null);

      const result = await callGenerateSuggestions();

      const searchSuggestion = result.find((s) => s.type === 'search');
      expect(searchSuggestion?.informationType).toBe('flow');
    });
  });

  describe('engine selection and fallback policy', () => {
    const agenticSuggestion: PathSuggestion = {
      type: 'search',
      path: '/tech/React/',
      label: 'Save near related pages',
      description: 'Found by iterative exploration.',
      grant: 1,
      informationType: 'stock',
    };

    it('should return memo + agentic suggestions when Mastra AI is configured and the agentic engine succeeds', async () => {
      mocks.isAiConfiguredMock.mockReturnValue(true);
      mocks.agenticEngineMock.mockResolvedValue([agenticSuggestion]);

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion, agenticSuggestion]);
    });

    it('should degrade to memo only (not throw) when the agentic engine rejects', async () => {
      mocks.isAiConfiguredMock.mockReturnValue(true);
      mocks.agenticEngineMock.mockRejectedValue(
        new Error('agent execution failed'),
      );

      const result = await callGenerateSuggestions();

      expect(result).toEqual([memoSuggestion]);
      expect(mocks.loggerErrorMock).toHaveBeenCalled();
    });

    it('should return memo only (not throw) when neither Mastra AI nor full-text search is available', async () => {
      const unreachableSearchService = mock<SearchService>({
        isReachable: false,
      });
      const { generateSuggestions } = await import('./generate-suggestions');

      const result = await generateSuggestions(
        mockUser,
        'Some page content',
        mockUserGroups,
        unreachableSearchService,
      );

      expect(result).toEqual([memoSuggestion]);
      expect(mocks.agenticEngineMock).not.toHaveBeenCalled();
      expect(mocks.analyzeContentMock).not.toHaveBeenCalled();
    });
  });
});
