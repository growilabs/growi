import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import request from 'supertest';

import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

// Mutable test state — controls mock behavior per test
const testState = vi.hoisted(() => ({
  authenticateUser: true,
  aiEnabled: true,
  openaiServiceType: 'openai' as string | null,
  disableUserPages: false,
  // Phase 2 controls
  extractedKeywords: [] as string[],
  extractKeywordsError: null as Error | null,
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

// Mock extractKeywords — configurable per test via testState
vi.mock('./extract-keywords', () => ({
  extractKeywords: vi.fn().mockImplementation(() => {
    if (testState.extractKeywordsError != null) {
      return Promise.reject(testState.extractKeywordsError);
    }
    return Promise.resolve(testState.extractedKeywords);
  }),
}));

// Mock resolveParentGrant — returns configurable grant value via testState
vi.mock('./resolve-parent-grant', () => ({
  resolveParentGrant: vi.fn().mockImplementation(() => {
    return Promise.resolve(testState.parentGrant);
  }),
}));

describe('POST /suggest-path integration', () => {
  let app: express.Application;
  let mockSearchKeyword: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Reset test state to defaults
    testState.authenticateUser = true;
    testState.aiEnabled = true;
    testState.openaiServiceType = 'openai';
    testState.disableUserPages = false;
    testState.extractedKeywords = [];
    testState.extractKeywordsError = null;
    testState.parentGrant = 1;

    mockSearchKeyword = vi.fn().mockResolvedValue([{ data: [] }, undefined]);

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
    const { suggestPathHandlersFactory } = await import('./suggest-path');
    const mockCrowi = {
      searchService: { searchKeyword: mockSearchKeyword },
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

  describe('Phase 2 — multi-suggestion response', () => {
    const searchResults = [
      { _score: 10, _source: { path: '/tech-notes/React/hooks-guide' } },
      { _score: 8, _source: { path: '/tech-notes/React/state-management' } },
      { _score: 5, _source: { path: '/tech-notes/React/best-practices' } },
    ];

    describe('complete flow with all suggestion types', () => {
      it('should return memo, search, and category suggestions when keywords extracted and search results found', async () => {
        testState.extractedKeywords = ['React', 'hooks'];
        mockSearchKeyword.mockResolvedValue([
          { data: searchResults },
          undefined,
        ]);

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
        testState.extractedKeywords = ['React', 'hooks'];
        mockSearchKeyword.mockResolvedValue([
          { data: searchResults },
          undefined,
        ]);

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

      it('should return search suggestion with parent directory path and related page titles in description', async () => {
        testState.extractedKeywords = ['React', 'hooks'];
        mockSearchKeyword.mockResolvedValue([
          { data: searchResults },
          undefined,
        ]);

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        const searchSuggestion = response.body.suggestions[1];
        expect(searchSuggestion.type).toBe('search');
        expect(searchSuggestion.path).toBe('/tech-notes/React/');
        expect(searchSuggestion.label).toBe('Save near related pages');
        expect(searchSuggestion.description).toBe(
          'Related pages under this directory: hooks-guide, state-management, best-practices',
        );
        expect(searchSuggestion.grant).toBe(1);
      });

      it('should return category suggestion with top-level segment path and category name in description', async () => {
        testState.extractedKeywords = ['React', 'hooks'];
        mockSearchKeyword.mockResolvedValue([
          { data: searchResults },
          undefined,
        ]);

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        const categorySuggestion = response.body.suggestions[2];
        expect(categorySuggestion.type).toBe('category');
        expect(categorySuggestion.path).toBe('/tech-notes/');
        expect(categorySuggestion.label).toBe('Save under category');
        expect(categorySuggestion.description).toBe(
          'Top-level category: tech-notes',
        );
        expect(categorySuggestion.grant).toBe(1);
      });
    });

    describe('response structure verification', () => {
      it('should have trailing slashes on all suggestion paths', async () => {
        testState.extractedKeywords = ['React', 'hooks'];
        mockSearchKeyword.mockResolvedValue([
          { data: searchResults },
          undefined,
        ]);

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        for (const suggestion of response.body.suggestions) {
          expect(suggestion.path).toMatch(/\/$/);
        }
      });

      it('should include all required fields in every suggestion', async () => {
        testState.extractedKeywords = ['React', 'hooks'];
        mockSearchKeyword.mockResolvedValue([
          { data: searchResults },
          undefined,
        ]);

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
        testState.extractedKeywords = ['React', 'hooks'];
        mockSearchKeyword.mockResolvedValue([
          { data: searchResults },
          undefined,
        ]);

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        for (const suggestion of response.body.suggestions) {
          expect(typeof suggestion.grant).toBe('number');
        }
      });
    });

    describe('graceful degradation', () => {
      it('should return memo-only when keyword extraction fails', async () => {
        testState.extractKeywordsError = new Error('AI service unavailable');

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        expect(response.body.suggestions).toHaveLength(1);
        expect(response.body.suggestions[0].type).toBe('memo');
      });

      it('should return memo-only when keyword extraction returns empty array', async () => {
        // testState.extractedKeywords is [] by default

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        expect(response.body.suggestions).toHaveLength(1);
        expect(response.body.suggestions[0].type).toBe('memo');
      });

      it('should omit search and category suggestions when search returns no results', async () => {
        testState.extractedKeywords = ['React', 'hooks'];
        mockSearchKeyword.mockResolvedValue([{ data: [] }, undefined]);

        const response = await request(app)
          .post('/suggest-path')
          .send({ body: 'Content about React hooks' })
          .expect(200);

        expect(response.body.suggestions).toHaveLength(1);
        expect(response.body.suggestions[0].type).toBe('memo');
      });

      it('should return correct memo structure even when Phase 2 degrades', async () => {
        testState.extractKeywordsError = new Error('AI service unavailable');

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
    });
  });
});
