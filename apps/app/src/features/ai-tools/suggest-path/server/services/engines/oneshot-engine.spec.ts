import type { IUserHasId } from '@growi/core/dist/interfaces';
import { mock } from 'vitest-mock-extended';

import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';

import type {
  ContentAnalysis,
  EvaluatedSuggestion,
  PathSuggestion,
  SearchCandidate,
  SearchService,
} from '../../../interfaces/suggest-path-types';

const mocks = vi.hoisted(() => {
  return {
    analyzeContentMock: vi.fn(),
    retrieveSearchCandidatesMock: vi.fn(),
    evaluateCandidatesMock: vi.fn(),
    generateCategorySuggestionMock: vi.fn(),
    resolveParentGrantMock: vi.fn(),
    loggerErrorMock: vi.fn(),
  };
});

vi.mock('../analyze-content', () => ({
  analyzeContent: mocks.analyzeContentMock,
}));

vi.mock('../retrieve-search-candidates', () => ({
  retrieveSearchCandidates: mocks.retrieveSearchCandidatesMock,
}));

vi.mock('../evaluate-candidates', () => ({
  evaluateCandidates: mocks.evaluateCandidatesMock,
}));

vi.mock('../generate-category-suggestion', () => ({
  generateCategorySuggestion: mocks.generateCategorySuggestionMock,
}));

vi.mock('../resolve-parent-grant', () => ({
  resolveParentGrant: mocks.resolveParentGrantMock,
}));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    error: mocks.loggerErrorMock,
  }),
}));

const mockUser = mock<IUserHasId>({ username: 'alice' });

const mockUserGroups: ObjectIdLike[] = ['group1', 'group2'];

const mockSearchService = mock<SearchService>();

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

describe('oneshotEngine', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const callOneshotEngine = async () => {
    const { oneshotEngine } = await import('./oneshot-engine');
    return oneshotEngine({
      user: mockUser,
      body: 'Some page content',
      userGroups: mockUserGroups,
      searchService: mockSearchService,
    });
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

    it('should return search + category suggestions when all succeed', async () => {
      const result = await callOneshotEngine();

      expect(result).toHaveLength(3); // 2 search + 1 category
      expect(result[0]).toMatchObject({ type: 'search', path: '/tech/React/' });
      expect(result[1]).toMatchObject({
        type: 'search',
        path: '/tech/React/performance/',
      });
      expect(result[2]).toEqual(categorySuggestion);
    });

    it('should never include a memo-type suggestion (memo is the orchestrator responsibility)', async () => {
      const result = await callOneshotEngine();

      expect(
        result.every((s) => s.type === 'search' || s.type === 'category'),
      ).toBe(true);
    });

    it('should map informationType from content analysis to search-type suggestions', async () => {
      const result = await callOneshotEngine();

      const searchSuggestions = result.filter((s) => s.type === 'search');
      expect(searchSuggestions).toHaveLength(2);
      for (const s of searchSuggestions) {
        expect(s.informationType).toBe('stock');
      }
    });

    it('should not include informationType on category suggestion', async () => {
      const result = await callOneshotEngine();

      const category = result.find((s) => s.type === 'category');
      expect(category?.informationType).toBeUndefined();
    });

    it('should resolve grant for each evaluated suggestion path', async () => {
      mocks.resolveParentGrantMock
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(4);

      const result = await callOneshotEngine();

      expect(mocks.resolveParentGrantMock).toHaveBeenCalledTimes(2);
      expect(mocks.resolveParentGrantMock).toHaveBeenCalledWith('/tech/React/');
      expect(mocks.resolveParentGrantMock).toHaveBeenCalledWith(
        '/tech/React/performance/',
      );
      expect(result[0].grant).toBe(1);
      expect(result[1].grant).toBe(4);
    });

    it('should pass body to analyzeContent', async () => {
      await callOneshotEngine();

      expect(mocks.analyzeContentMock).toHaveBeenCalledWith(
        'Some page content',
      );
    });

    it('should pass keywords, user, userGroups, and searchService to retrieveSearchCandidates', async () => {
      await callOneshotEngine();

      expect(mocks.retrieveSearchCandidatesMock).toHaveBeenCalledWith(
        ['React', 'hooks'],
        mockUser,
        mockUserGroups,
        mockSearchService,
      );
    });

    it('should pass body, analysis, and candidates to evaluateCandidates', async () => {
      await callOneshotEngine();

      expect(mocks.evaluateCandidatesMock).toHaveBeenCalledWith(
        'Some page content',
        mockAnalysis,
        mockCandidates,
      );
    });

    it('should pass candidates to generateCategorySuggestion', async () => {
      await callOneshotEngine();

      expect(mocks.generateCategorySuggestionMock).toHaveBeenCalledWith(
        mockCandidates,
      );
    });
  });

  describe('graceful degradation', () => {
    it('should return an empty array when content analysis fails', async () => {
      mocks.analyzeContentMock.mockRejectedValue(
        new Error('AI service unavailable'),
      );

      const result = await callOneshotEngine();

      expect(result).toEqual([]);
      expect(mocks.retrieveSearchCandidatesMock).not.toHaveBeenCalled();
      expect(mocks.evaluateCandidatesMock).not.toHaveBeenCalled();
      expect(mocks.generateCategorySuggestionMock).not.toHaveBeenCalled();
    });

    it('should log error when content analysis fails', async () => {
      mocks.analyzeContentMock.mockRejectedValue(
        new Error('AI service unavailable'),
      );

      await callOneshotEngine();

      expect(mocks.loggerErrorMock).toHaveBeenCalled();
    });

    it('should return an empty array when search candidate retrieval fails', async () => {
      mocks.analyzeContentMock.mockResolvedValue(mockAnalysis);
      mocks.retrieveSearchCandidatesMock.mockRejectedValue(
        new Error('Search service down'),
      );

      const result = await callOneshotEngine();

      expect(result).toEqual([]);
      expect(mocks.evaluateCandidatesMock).not.toHaveBeenCalled();
      expect(mocks.generateCategorySuggestionMock).not.toHaveBeenCalled();
      expect(mocks.loggerErrorMock).toHaveBeenCalled();
    });

    it('should return category only when candidate evaluation fails', async () => {
      mocks.analyzeContentMock.mockResolvedValue(mockAnalysis);
      mocks.retrieveSearchCandidatesMock.mockResolvedValue(mockCandidates);
      mocks.evaluateCandidatesMock.mockRejectedValue(
        new Error('AI evaluation failed'),
      );
      mocks.generateCategorySuggestionMock.mockResolvedValue(
        categorySuggestion,
      );

      const result = await callOneshotEngine();

      expect(result).toEqual([categorySuggestion]);
      expect(mocks.loggerErrorMock).toHaveBeenCalled();
    });

    it('should return search suggestions only when category generation fails', async () => {
      mocks.analyzeContentMock.mockResolvedValue(mockAnalysis);
      mocks.retrieveSearchCandidatesMock.mockResolvedValue(mockCandidates);
      mocks.evaluateCandidatesMock.mockResolvedValue(mockEvaluated);
      mocks.resolveParentGrantMock.mockResolvedValue(1);
      mocks.generateCategorySuggestionMock.mockRejectedValue(
        new Error('Category failed'),
      );

      const result = await callOneshotEngine();

      expect(result).toHaveLength(2); // 2 search (no category)
      expect(result[0]).toMatchObject({ type: 'search' });
      expect(result[1]).toMatchObject({ type: 'search' });
      expect(mocks.loggerErrorMock).toHaveBeenCalled();
    });

    it('should skip candidate evaluation when no candidates pass threshold (empty array)', async () => {
      mocks.analyzeContentMock.mockResolvedValue(mockAnalysis);
      mocks.retrieveSearchCandidatesMock.mockResolvedValue([]);
      mocks.generateCategorySuggestionMock.mockResolvedValue(null);

      const result = await callOneshotEngine();

      expect(result).toEqual([]);
      expect(mocks.evaluateCandidatesMock).not.toHaveBeenCalled();
      // Category generation still receives the (empty) candidates, as in the original pipeline
      expect(mocks.generateCategorySuggestionMock).toHaveBeenCalledWith([]);
    });

    it('should omit category when generateCategorySuggestion returns null', async () => {
      mocks.analyzeContentMock.mockResolvedValue(mockAnalysis);
      mocks.retrieveSearchCandidatesMock.mockResolvedValue(mockCandidates);
      mocks.evaluateCandidatesMock.mockResolvedValue(mockEvaluated);
      mocks.resolveParentGrantMock.mockResolvedValue(1);
      mocks.generateCategorySuggestionMock.mockResolvedValue(null);

      const result = await callOneshotEngine();

      expect(result).toHaveLength(2); // 2 search, no category
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

      const result = await callOneshotEngine();

      const searchSuggestion = result.find((s) => s.type === 'search');
      expect(searchSuggestion?.informationType).toBe('flow');
    });
  });
});
