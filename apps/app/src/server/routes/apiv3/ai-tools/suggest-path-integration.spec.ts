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

// Mock extractKeywords — return empty array so Phase 2 falls back to memo-only
vi.mock('./extract-keywords', () => ({
  extractKeywords: vi.fn().mockResolvedValue([]),
}));

describe('POST /suggest-path — Phase 1 integration', () => {
  let app: express.Application;

  beforeEach(async () => {
    // Reset test state to defaults
    testState.authenticateUser = true;
    testState.aiEnabled = true;
    testState.openaiServiceType = 'openai';
    testState.disableUserPages = false;

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
      searchService: { searchKeyword: vi.fn() },
    } as unknown as Crowi;
    app.post('/suggest-path', suggestPathHandlersFactory(mockCrowi));
  });

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
