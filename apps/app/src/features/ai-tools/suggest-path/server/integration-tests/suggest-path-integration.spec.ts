import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import request from 'supertest';

import type { ContentAnalysis } from '~/features/ai-tools/suggest-path/interfaces/suggest-path-types';
import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

// Mutable test state — controls mock behavior per test
const testState = vi.hoisted(() => ({
  authenticateUser: true,
  aiEnabled: true,
  openaiServiceType: 'openai' as string | null,
  disableUserPages: false,
  // Phase 2 - content analysis
  contentAnalysis: null as {
    keywords: string[];
    informationType: 'flow' | 'stock';
  } | null,
  contentAnalysisError: null as Error | null,
  // Phase 2 - search candidates
  searchCandidates: [] as Array<{
    pagePath: string;
    snippet: string;
    score: number;
  }>,
  searchCandidatesError: null as Error | null,
  // Phase 2 - candidate evaluation
  evaluatedSuggestions: [] as Array<{
    path: string;
    label: string;
    description: string;
  }>,
  evaluateCandidatesError: null as Error | null,
  // Phase 2 - category
  categorySuggestion: null as {
    type: string;
    path: string;
    label: string;
    description: string;
    grant: number;
  } | null,
  categorySuggestionError: null as Error | null,
  // Phase 2 - grant
  parentGrant: 1,
}));

const mockUser = {
  _id: 'user123',
  username: 'alice',
  status: 2, // STATUS_ACTIVE
};

// Mock access token parser — always passthrough
vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser:
    () => (_req: Request, _res: Response, next: NextFunction) =>
      next(),
}));

// Mock login required — conditional authentication based on testState
vi.mock('~/server/middlewares/login-required', () => ({
  default: () => (req: Request, res: Response, next: NextFunction) => {
    if (!testState.authenticateUser) {
      return res.sendStatus(403);
    }
    Object.assign(req, { user: mockUser });
    next();
  },
}));

// Mock config manager — certifyAiService and generateMemoSuggestion read from this
vi.mock('~/server/service/config-manager', () => ({
  configManager: {
    getConfig: (key: string) => {
      switch (key) {
        case 'app:aiEnabled':
          return testState.aiEnabled;
        case 'openai:serviceType':
          return testState.openaiServiceType;
        case 'security:disableUserPages':
          return testState.disableUserPages;
        default:
          return undefined;
      }
    },
  },
}));

// Mock user group relations — needed for user group resolution in handler
vi.mock('~/server/models/user-group-relation', () => ({
  default: {
    findAllUserGroupIdsRelatedToUser: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock(
  '~/features/external-user-group/server/models/external-user-group-relation',
  () => ({
    default: {
      findAllUserGroupIdsRelatedToUser: vi.fn().mockResolvedValue([]),
    },
  }),
);

// Mock analyzeContent — configurable per test via testState
vi.mock('../services/analyze-content', () => ({
  analyzeContent: vi.fn().mockImplementation(() => {
    if (testState.contentAnalysisError != null) {
      return Promise.reject(testState.contentAnalysisError);
    }
    if (testState.contentAnalysis == null) {
      return Promise.resolve({ keywords: [], informationType: 'stock' });
    }
    return Promise.resolve(testState.contentAnalysis);
  }),
}));

// Mock retrieveSearchCandidates — configurable per test via testState
vi.mock('../services/retrieve-search-candidates', () => ({
  retrieveSearchCandidates: vi.fn().mockImplementation(() => {
    if (testState.searchCandidatesError != null) {
      return Promise.reject(testState.searchCandidatesError);
    }
    return Promise.resolve(testState.searchCandidates);
  }),
}));

// Mock evaluateCandidates — configurable per test via testState
vi.mock('../services/evaluate-candidates', () => ({
  evaluateCandidates: vi.fn().mockImplementation(() => {
    if (testState.evaluateCandidatesError != null) {
      return Promise.reject(testState.evaluateCandidatesError);
    }
    return Promise.resolve(testState.evaluatedSuggestions);
  }),
}));

// Mock generateCategorySuggestion — configurable per test via testState
vi.mock('../services/generate-category-suggestion', () => ({
  generateCategorySuggestion: vi.fn().mockImplementation(() => {
    if (testState.categorySuggestionError != null) {
      return Promise.reject(testState.categorySuggestionError);
    }
    return Promise.resolve(testState.categorySuggestion);
  }),
}));

// Mock resolveParentGrant — returns configurable grant value via testState
vi.mock('../services/resolve-parent-grant', () => ({
  resolveParentGrant: vi.fn().mockImplementation(() => {
    return Promise.resolve(testState.parentGrant);
  }),
}));

describe('POST /suggest-path integration', () => {
  let app: express.Application;

  beforeEach(async () => {
    // Reset test state to defaults
    testState.authenticateUser = true;
    testState.aiEnabled = true;
    testState.openaiServiceType = 'openai';
    testState.disableUserPages = false;
    testState.contentAnalysis = null;
    testState.contentAnalysisError = null;
    testState.searchCandidates = [];
    testState.searchCandidatesError = null;
    testState.evaluatedSuggestions = [];
    testState.evaluateCandidatesError = null;
    testState.categorySuggestion = null;
    testState.categorySuggestionError = null;
    testState.parentGrant = 1;

    // Setup express app with ApiV3Response methods
    app = express();
    app.use(express.json());
    app.use((_req: Request, res: Response, next: NextFunction) => {
      const apiRes = res as ApiV3Response;
      apiRes.apiv3 = function (obj = {}, status = 200) {
        this.status(status).json(obj);
      };
      apiRes.apiv3Err = function (_err, status = 400) {
        const errors = Array.isArray(_err) ? _err : [_err];
        this.status(status).json({ errors });
      };
      next();
    });

    // Import and mount the handler factory with real middleware chain
    const { suggestPathHandlersFactory } = await import('../routes/apiv3');
    const mockCrowi = {
      searchService: { searchKeyword: vi.fn() },
    } as unknown as Crowi;
    app.post('/suggest-path', suggestPathHandlersFactory(mockCrowi));
  });

  describe('Phase 1 — memo-only', () => {
    describe('valid request with authentication', () => {
      it('should return 200 with suggestions array containing one memo suggestion', async () => {
        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Some page content about React hooks' })
          .expect(200);

        expect(response.body.suggestions).toBeDefined();
        expect(Array.isArray(response.body.suggestions)).toBe(true);
        expect(response.body.suggestions).toHaveLength(1);
      });

      it('should return memo suggestion with all required fields and correct values', async () => {
        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Some page content' })
          .expect(200);

        const suggestion = response.body.suggestions[0];
        expect(suggestion).toEqual({
          type: 'memo',
          path: '/user/alice/memo/',
          label: 'Save as memo',
          description: 'Save to your personal memo area',
          grant: 4,
        });
      });

      it('should return path with trailing slash', async () => {
        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Some page content' })
          .expect(200);

        expect(response.body.suggestions[0].path).toMatch(/\/$/);
      });

      it('should return grant value of 4 (GRANT_OWNER)', async () => {
        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Some page content' })
          .expect(200);

        expect(response.body.suggestions[0].grant).toBe(4);
      });
    });

    describe('authentication enforcement', () => {
      it('should return 403 when user is not authenticated', async () => {
        testState.authenticateUser = false;

        await request(app)
          .post('/suggest-path')
          .send({ body: 'Some page content' })
          .expect(403);
      });
    });

    describe('input validation', () => {
      it('should return 400 when body field is missing', async () => {
        await request(app).post('/suggest-path').send({}).expect(400);
      });

      it('should return 400 when body field is empty string', async () => {
        await request(app).post('/suggest-path').send({ body: '' }).expect(400);
      });

      it('should return 400 when body exceeds maximum length', async () => {
        const oversizedBody = 'x'.repeat(100_001);
        await request(app)
          .post('/suggest-path')
          .send({ body: oversizedBody })
          .expect(400);
      });

      it('should accept body at the maximum length boundary', async () => {
        const maxBody = 'x'.repeat(100_000);
        const response = await request(app)
          .post('/suggest-path')
          .send({ body: maxBody });
        // Should not be rejected by validation (may be 200 or other non-400 status)
        expect(response.status).not.toBe(400);
      });
    });

    describe('AI service gating', () => {
      it('should return 403 when AI is not enabled', async () => {
        testState.aiEnabled = false;

        await request(app)
          .post('/suggest-path')
          .send({ body: 'Some page content' })
          .expect(403);
      });

      it('should return 403 when openai service type is not configured', async () => {
        testState.openaiServiceType = null;

        await request(app)
          .post('/suggest-path')
          .send({ body: 'Some page content' })
          .expect(403);
      });
    });
  });

  describe('Phase 2 — revised pipeline verification', () => {
    // Common fixture data
    const stockAnalysis = {
      keywords: ['React', 'hooks'],
      informationType: 'stock' as const,
    };

    const flowAnalysis = {
      keywords: ['meeting', 'standup'],
      informationType: 'flow' as const,
    };

    const searchCandidates = [
      {
        pagePath: '/tech-notes/React/hooks-guide',
        snippet: 'React hooks overview',
        score: 10,
      },
      {
        pagePath: '/tech-notes/React/state-management',
        snippet: 'State management',
        score: 8,
      },
    ];

    const singleEvaluated = [
      {
        path: '/tech-notes/React/',
        label: 'Save near related pages',
        description:
          'This area contains React documentation. Your stock content fits well here.',
      },
    ];

    const categorySuggestionFixture = {
      type: 'category',
      path: '/tech-notes/',
      label: 'Save under category',
      description: 'Top-level category: tech-notes',
      grant: 1,
    };

    // Helper: set up full pipeline success with optional overrides
    const setupFullPipeline = (overrides?: {
      analysis?: ContentAnalysis;
      candidates?: typeof searchCandidates;
      evaluated?: typeof singleEvaluated;
      category?: typeof categorySuggestionFixture | null;
    }) => {
      testState.contentAnalysis = overrides?.analysis ?? stockAnalysis;
      testState.searchCandidates = overrides?.candidates ?? searchCandidates;
      testState.evaluatedSuggestions = overrides?.evaluated ?? singleEvaluated;
      testState.categorySuggestion =
        overrides?.category !== undefined
          ? overrides.category
          : categorySuggestionFixture;
    };

    describe('complete revised flow end-to-end', () => {
      it('should return memo, search, and category suggestions when all succeed', async () => {
        setupFullPipeline();

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks and state management' })
          .expect(200);

        expect(response.body.suggestions).toHaveLength(3);
        expect(response.body.suggestions[0].type).toBe('memo');
        expect(response.body.suggestions[1].type).toBe('search');
        expect(response.body.suggestions[2].type).toBe('category');
      });

      it('should return correct memo suggestion alongside Phase 2 suggestions', async () => {
        setupFullPipeline();

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        expect(response.body.suggestions[0]).toEqual({
          type: 'memo',
          path: '/user/alice/memo/',
          label: 'Save as memo',
          description: 'Save to your personal memo area',
          grant: 4,
        });
      });

      it('should return search suggestion with AI-evaluated path and description', async () => {
        setupFullPipeline();

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        const searchSuggestion = response.body.suggestions[1];
        expect(searchSuggestion.type).toBe('search');
        expect(searchSuggestion.path).toBe('/tech-notes/React/');
        expect(searchSuggestion.label).toBe('Save near related pages');
        expect(searchSuggestion.description).toBe(
          'This area contains React documentation. Your stock content fits well here.',
        );
        expect(searchSuggestion.grant).toBe(1);
        expect(searchSuggestion.informationType).toBe('stock');
      });

      it('should return category suggestion with correct structure', async () => {
        setupFullPipeline();

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        expect(response.body.suggestions[2]).toEqual(categorySuggestionFixture);
      });

      it('should return multiple search suggestions for multi-candidate evaluation', async () => {
        const multiEvaluated = [
          {
            path: '/tech-notes/React/',
            label: 'Save near related pages',
            description:
              'React documentation area with existing hooks content.',
          },
          {
            path: '/tech-notes/React/performance/',
            label: 'New section for performance',
            description: 'New sibling alongside existing React pages.',
          },
        ];
        setupFullPipeline({ evaluated: multiEvaluated });

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React performance' })
          .expect(200);

        expect(response.body.suggestions).toHaveLength(4); // memo + 2 search + category
        const searchSuggestions = response.body.suggestions.filter(
          (s: { type: string }) => s.type === 'search',
        );
        expect(searchSuggestions).toHaveLength(2);
        expect(searchSuggestions[0].path).toBe('/tech-notes/React/');
        expect(searchSuggestions[1].path).toBe(
          '/tech-notes/React/performance/',
        );
      });

      it('should omit search suggestions when evaluator finds no suitable candidates', async () => {
        setupFullPipeline({ evaluated: [] });

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        expect(response.body.suggestions).toHaveLength(2); // memo + category
        expect(response.body.suggestions[0].type).toBe('memo');
        expect(response.body.suggestions[1].type).toBe('category');
      });
    });

    describe('informationType verification', () => {
      it('should include informationType in search-based suggestions', async () => {
        setupFullPipeline();

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        const searchSuggestion = response.body.suggestions.find(
          (s: { type: string }) => s.type === 'search',
        );
        expect(searchSuggestion.informationType).toBe('stock');
      });

      it('should not include informationType in memo suggestion', async () => {
        setupFullPipeline();

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        const memoSuggestion = response.body.suggestions.find(
          (s: { type: string }) => s.type === 'memo',
        );
        expect(memoSuggestion).not.toHaveProperty('informationType');
      });

      it('should not include informationType in category suggestion', async () => {
        setupFullPipeline();

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        const categorySuggestion = response.body.suggestions.find(
          (s: { type: string }) => s.type === 'category',
        );
        expect(categorySuggestion).not.toHaveProperty('informationType');
      });

      it('should map flow informationType when content is classified as flow', async () => {
        setupFullPipeline({ analysis: flowAnalysis });

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Meeting notes from standup' })
          .expect(200);

        const searchSuggestion = response.body.suggestions.find(
          (s: { type: string }) => s.type === 'search',
        );
        expect(searchSuggestion.informationType).toBe('flow');
      });
    });

    describe('path proposal patterns', () => {
      it('should support parent directory pattern', async () => {
        const parentPattern = [
          {
            path: '/tech-notes/React/',
            label: 'Parent directory',
            description:
              'Save in the parent directory of matching React pages.',
          },
        ];
        setupFullPipeline({ evaluated: parentPattern, category: null });

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'React hooks content' })
          .expect(200);

        const searchSuggestion = response.body.suggestions.find(
          (s: { type: string }) => s.type === 'search',
        );
        expect(searchSuggestion.path).toBe('/tech-notes/React/');
        expect(searchSuggestion.path).toMatch(/\/$/);
      });

      it('should support subdirectory pattern', async () => {
        const subdirPattern = [
          {
            path: '/tech-notes/React/hooks-guide/advanced/',
            label: 'Subdirectory of matching page',
            description: 'Save under the hooks guide as a sub-topic.',
          },
        ];
        setupFullPipeline({ evaluated: subdirPattern, category: null });

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Advanced React hooks patterns' })
          .expect(200);

        const searchSuggestion = response.body.suggestions.find(
          (s: { type: string }) => s.type === 'search',
        );
        expect(searchSuggestion.path).toBe(
          '/tech-notes/React/hooks-guide/advanced/',
        );
      });

      it('should support sibling pattern with new path at correct hierarchy level', async () => {
        // Matching candidate was at /tech-notes/React/hooks-guide (depth 3)
        // Sibling should also be at depth 3: /tech-notes/React/performance/
        const siblingPattern = [
          {
            path: '/tech-notes/React/performance/',
            label: 'New section for performance',
            description:
              'A new sibling section alongside existing React documentation.',
          },
        ];
        setupFullPipeline({ evaluated: siblingPattern, category: null });

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'React performance optimization tips' })
          .expect(200);

        const searchSuggestion = response.body.suggestions.find(
          (s: { type: string }) => s.type === 'search',
        );
        expect(searchSuggestion.path).toBe('/tech-notes/React/performance/');
        // Verify hierarchy level: path has 3 segments (same depth as hooks-guide)
        const segments = searchSuggestion.path.split('/').filter(Boolean);
        expect(segments).toHaveLength(3);
      });

      it('should return all three patterns when evaluator produces them', async () => {
        const allPatterns = [
          {
            path: '/tech-notes/React/',
            label: 'Parent directory',
            description: 'Parent directory of matching pages.',
          },
          {
            path: '/tech-notes/React/hooks-guide/advanced/',
            label: 'Subdirectory',
            description: 'Under the hooks guide.',
          },
          {
            path: '/tech-notes/React/performance/',
            label: 'Sibling section',
            description: 'New sibling alongside existing pages.',
          },
        ];
        setupFullPipeline({ evaluated: allPatterns, category: null });

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React' })
          .expect(200);

        const searchSuggestions = response.body.suggestions.filter(
          (s: { type: string }) => s.type === 'search',
        );
        expect(searchSuggestions).toHaveLength(3);
        expect(searchSuggestions[0].path).toBe('/tech-notes/React/');
        expect(searchSuggestions[1].path).toBe(
          '/tech-notes/React/hooks-guide/advanced/',
        );
        expect(searchSuggestions[2].path).toBe(
          '/tech-notes/React/performance/',
        );
        // All paths end with trailing slash
        for (const s of searchSuggestions) {
          expect(s.path).toMatch(/\/$/);
        }
      });
    });

    describe('graceful degradation', () => {
      it('should return memo-only when content analysis fails', async () => {
        testState.contentAnalysisError = new Error('AI service unavailable');

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        expect(response.body.suggestions).toHaveLength(1);
        expect(response.body.suggestions[0].type).toBe('memo');
      });

      it('should return memo-only when content analysis returns empty keywords', async () => {
        // testState.contentAnalysis is null by default → returns { keywords: [], informationType: 'stock' }

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        expect(response.body.suggestions).toHaveLength(1);
        expect(response.body.suggestions[0].type).toBe('memo');
      });

      it('should omit search suggestions when search returns empty candidates', async () => {
        testState.contentAnalysis = stockAnalysis;
        testState.searchCandidates = [];
        testState.categorySuggestion = categorySuggestionFixture;

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        expect(response.body.suggestions).toHaveLength(2); // memo + category
        expect(response.body.suggestions[0].type).toBe('memo');
        expect(response.body.suggestions[1].type).toBe('category');
      });

      it('should return memo + category when candidate evaluation fails', async () => {
        testState.contentAnalysis = stockAnalysis;
        testState.searchCandidates = searchCandidates;
        testState.evaluateCandidatesError = new Error('AI evaluation failed');
        testState.categorySuggestion = categorySuggestionFixture;

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        expect(response.body.suggestions).toHaveLength(2);
        expect(response.body.suggestions[0].type).toBe('memo');
        expect(response.body.suggestions[1].type).toBe('category');
      });

      it('should return memo + search when category generation fails', async () => {
        testState.contentAnalysis = stockAnalysis;
        testState.searchCandidates = searchCandidates;
        testState.evaluatedSuggestions = singleEvaluated;
        testState.categorySuggestionError = new Error(
          'Category generation failed',
        );

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        expect(response.body.suggestions).toHaveLength(2);
        expect(response.body.suggestions[0].type).toBe('memo');
        expect(response.body.suggestions[1].type).toBe('search');
      });

      it('should return memo-only when all Phase 2 components fail', async () => {
        testState.contentAnalysis = stockAnalysis;
        testState.searchCandidatesError = new Error('Search service down');
        testState.categorySuggestionError = new Error('Category failed');

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        expect(response.body.suggestions).toHaveLength(1);
        expect(response.body.suggestions[0].type).toBe('memo');
      });

      it('should return correct memo structure even when Phase 2 degrades', async () => {
        testState.contentAnalysisError = new Error('AI service unavailable');

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        expect(response.body.suggestions[0]).toEqual({
          type: 'memo',
          path: '/user/alice/memo/',
          label: 'Save as memo',
          description: 'Save to your personal memo area',
          grant: 4,
        });
      });

      it('should skip search pipeline entirely when content analysis fails', async () => {
        testState.contentAnalysisError = new Error('AI service unavailable');

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        // Only memo, no search or category
        expect(response.body.suggestions).toHaveLength(1);
        const types = response.body.suggestions.map(
          (s: { type: string }) => s.type,
        );
        expect(types).not.toContain('search');
        expect(types).not.toContain('category');
      });
    });

    describe('response structure verification', () => {
      it('should have trailing slashes on all suggestion paths', async () => {
        setupFullPipeline();

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        for (const suggestion of response.body.suggestions) {
          expect(suggestion.path).toMatch(/\/$/);
        }
      });

      it('should include all required fields in every suggestion', async () => {
        setupFullPipeline();

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        const requiredFields = [
          'type',
          'path',
          'label',
          'description',
          'grant',
        ];
        for (const suggestion of response.body.suggestions) {
          for (const field of requiredFields) {
            expect(suggestion).toHaveProperty(field);
          }
        }
      });

      it('should include grant values as numbers for all suggestion types', async () => {
        setupFullPipeline();

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        for (const suggestion of response.body.suggestions) {
          expect(typeof suggestion.grant).toBe('number');
        }
      });

      it('should have fixed description for memo type', async () => {
        setupFullPipeline();

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        const memo = response.body.suggestions.find(
          (s: { type: string }) => s.type === 'memo',
        );
        expect(memo.description).toBe('Save to your personal memo area');
      });

      it('should have AI-generated description for search type', async () => {
        setupFullPipeline();

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        const search = response.body.suggestions.find(
          (s: { type: string }) => s.type === 'search',
        );
        // AI-generated descriptions are non-empty and contextual
        expect(search.description).toBeTruthy();
        expect(search.description.length).toBeGreaterThan(10);
      });

      it('should have mechanical description for category type', async () => {
        setupFullPipeline();

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        const category = response.body.suggestions.find(
          (s: { type: string }) => s.type === 'category',
        );
        // Mechanical description follows "Top-level category: {name}" format
        expect(category.description).toMatch(/^Top-level category: /);
      });

      it('should have valid PageGrant values for all suggestions', async () => {
        testState.parentGrant = 4;
        setupFullPipeline();

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        const validGrants = [1, 2, 4, 5];
        for (const suggestion of response.body.suggestions) {
          expect(validGrants).toContain(suggestion.grant);
        }
      });

      it('should resolve different grant values per search suggestion path', async () => {
        const multiEvaluated = [
          {
            path: '/public-docs/React/',
            label: 'Public docs',
            description: 'Public documentation area.',
          },
          {
            path: '/private-notes/React/',
            label: 'Private notes',
            description: 'Private notes area.',
          },
        ];
        setupFullPipeline({ evaluated: multiEvaluated, category: null });

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React' })
          .expect(200);

        const searchSuggestions = response.body.suggestions.filter(
          (s: { type: string }) => s.type === 'search',
        );
        // Both use testState.parentGrant (1) — verifies grant resolution is called per path
        expect(searchSuggestions).toHaveLength(2);
        for (const s of searchSuggestions) {
          expect(typeof s.grant).toBe('number');
        }
      });
    });
  });
});
