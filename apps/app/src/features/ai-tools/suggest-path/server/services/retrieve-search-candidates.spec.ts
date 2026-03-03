import type { IUserHasId } from '@growi/core/dist/interfaces';

import type { SearchCandidate } from '../../interfaces/suggest-path-types';
import { retrieveSearchCandidates } from './retrieve-search-candidates';

type HighlightData = Record<string, string[]>;

type SearchResultPage = {
  path: string;
  score: number;
  highlight?: HighlightData;
};

function createSearchResult(pages: SearchResultPage[]) {
  return {
    data: pages.map((p) => ({
      _id: `id-${p.path}`,
      _score: p.score,
      _source: { path: p.path },
      _highlight: p.highlight,
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

describe('retrieveSearchCandidates', () => {
  describe('multi-result retrieval', () => {
    it('should return all candidates above the score threshold', async () => {
      const searchResult = createSearchResult([
        { path: '/tech/React/hooks', score: 15 },
        { path: '/tech/React/state', score: 12 },
        { path: '/tech/Vue/basics', score: 8 },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await retrieveSearchCandidates(
        ['React', 'hooks'],
        mockUser,
        [],
        { searchService, scoreThreshold: 5 },
      );

      expect(result).toHaveLength(3);
    });

    it('should return candidates with correct structure', async () => {
      const searchResult = createSearchResult([
        {
          path: '/tech/React/hooks',
          score: 15,
          highlight: { body: ['Using <em>React</em> hooks for state'] },
        },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await retrieveSearchCandidates(['React'], mockUser, [], {
        searchService,
        scoreThreshold: 5,
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        pagePath: '/tech/React/hooks',
        snippet: 'Using React hooks for state',
        score: 15,
      } satisfies SearchCandidate);
    });
  });

  describe('threshold filtering', () => {
    it('should include candidates above the threshold', async () => {
      const searchResult = createSearchResult([
        { path: '/tech/React/hooks', score: 15 },
        { path: '/tech/React/state', score: 3 },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await retrieveSearchCandidates(['React'], mockUser, [], {
        searchService,
        scoreThreshold: 10,
      });

      expect(result).toHaveLength(1);
      expect(result[0].pagePath).toBe('/tech/React/hooks');
    });

    it('should exclude candidates below the threshold', async () => {
      const searchResult = createSearchResult([
        { path: '/tech/React/hooks', score: 3 },
        { path: '/tech/Vue/basics', score: 2 },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await retrieveSearchCandidates(['React'], mockUser, [], {
        searchService,
        scoreThreshold: 10,
      });

      expect(result).toHaveLength(0);
    });

    it('should include candidates at exactly the threshold', async () => {
      const searchResult = createSearchResult([
        { path: '/tech/React/hooks', score: 10 },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await retrieveSearchCandidates(['React'], mockUser, [], {
        searchService,
        scoreThreshold: 10,
      });

      expect(result).toHaveLength(1);
      expect(result[0].score).toBe(10);
    });

    it('should filter mixed results correctly', async () => {
      const searchResult = createSearchResult([
        { path: '/tech/React/hooks', score: 20 },
        { path: '/tech/React/state', score: 10 },
        { path: '/guides/intro', score: 5 },
        { path: '/random/page', score: 2 },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await retrieveSearchCandidates(['React'], mockUser, [], {
        searchService,
        scoreThreshold: 10,
      });

      expect(result).toHaveLength(2);
      expect(result.map((c) => c.pagePath)).toEqual([
        '/tech/React/hooks',
        '/tech/React/state',
      ]);
    });
  });

  describe('empty result handling', () => {
    it('should return empty array when search returns no results', async () => {
      const searchResult = createSearchResult([]);
      const searchService = createMockSearchService(searchResult);

      const result = await retrieveSearchCandidates(
        ['nonexistent'],
        mockUser,
        [],
        { searchService, scoreThreshold: 5 },
      );

      expect(result).toEqual([]);
    });

    it('should return empty array when all results are below threshold', async () => {
      const searchResult = createSearchResult([
        { path: '/tech/React/hooks', score: 3 },
        { path: '/tech/Vue/basics', score: 1 },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await retrieveSearchCandidates(['React'], mockUser, [], {
        searchService,
        scoreThreshold: 5,
      });

      expect(result).toEqual([]);
    });
  });

  describe('snippet extraction', () => {
    it('should extract snippet from _highlight.body', async () => {
      const searchResult = createSearchResult([
        {
          path: '/tech/React/hooks',
          score: 15,
          highlight: {
            body: ["Using <em class='highlighted-keyword'>React</em> hooks"],
          },
        },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await retrieveSearchCandidates(['React'], mockUser, [], {
        searchService,
        scoreThreshold: 5,
      });

      expect(result[0].snippet).toBe('Using React hooks');
    });

    it('should fall back to body.en highlight', async () => {
      const searchResult = createSearchResult([
        {
          path: '/tech/React/hooks',
          score: 15,
          highlight: {
            'body.en': ['<em>React</em> hooks guide'],
          },
        },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await retrieveSearchCandidates(['React'], mockUser, [], {
        searchService,
        scoreThreshold: 5,
      });

      expect(result[0].snippet).toBe('React hooks guide');
    });

    it('should fall back to body.ja highlight', async () => {
      const searchResult = createSearchResult([
        {
          path: '/tech/React/hooks',
          score: 15,
          highlight: {
            'body.ja': ['<em>React</em>のフックについて'],
          },
        },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await retrieveSearchCandidates(['React'], mockUser, [], {
        searchService,
        scoreThreshold: 5,
      });

      expect(result[0].snippet).toBe('Reactのフックについて');
    });

    it('should return empty string when no highlight is available', async () => {
      const searchResult = createSearchResult([
        { path: '/tech/React/hooks', score: 15 },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await retrieveSearchCandidates(['React'], mockUser, [], {
        searchService,
        scoreThreshold: 5,
      });

      expect(result[0].snippet).toBe('');
    });

    it('should join multiple highlight fragments', async () => {
      const searchResult = createSearchResult([
        {
          path: '/tech/React/hooks',
          score: 15,
          highlight: {
            body: ['<em>React</em> hooks', 'custom <em>hooks</em> pattern'],
          },
        },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await retrieveSearchCandidates(['React'], mockUser, [], {
        searchService,
        scoreThreshold: 5,
      });

      expect(result[0].snippet).toBe('React hooks ... custom hooks pattern');
    });

    it('should strip all HTML tags from snippets', async () => {
      const searchResult = createSearchResult([
        {
          path: '/tech/React/hooks',
          score: 15,
          highlight: {
            body: [
              "<em class='highlighted-keyword'>React</em> <strong>hooks</strong>",
            ],
          },
        },
      ]);
      const searchService = createMockSearchService(searchResult);

      const result = await retrieveSearchCandidates(['React'], mockUser, [], {
        searchService,
        scoreThreshold: 5,
      });

      expect(result[0].snippet).toBe('React hooks');
    });
  });

  describe('search service invocation', () => {
    it('should join keywords with spaces for search query', async () => {
      const searchResult = createSearchResult([]);
      const searchService = createMockSearchService(searchResult);

      await retrieveSearchCandidates(
        ['React', 'hooks', 'useState'],
        mockUser,
        [],
        { searchService, scoreThreshold: 5 },
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
      const searchResult = createSearchResult([]);
      const searchService = createMockSearchService(searchResult);
      const mockUserGroups = ['group1', 'group2'];

      await retrieveSearchCandidates(['React'], mockUser, mockUserGroups, {
        searchService,
        scoreThreshold: 5,
      });

      expect(searchService.searchKeyword).toHaveBeenCalledWith(
        expect.any(String),
        null,
        mockUser,
        mockUserGroups,
        expect.any(Object),
      );
    });
  });
});
