import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

import type { AgenticEngineOutput } from '../services/engines/agentic-output-schema';

/**
 * Route integration for engine selection (task 6.1): requests travel through
 * the real middleware chain (validator + apiV3FormValidator + handler), the
 * real orchestrator + dispatcher, and the REAL agentic engine adapter.
 *
 * Only process-external seams are mocked:
 * - the oneshot pipeline services (same seams as suggest-path-integration.spec.ts)
 * - resolveParentGrant (mongoose-backed)
 * - the Mastra registry: its transitive `@mastra/core/agent` import cannot
 *   load under vitest (pnpm `@mastra/core>p-map` override — see tasks.md
 *   Implementation Notes), so `mastra.getAgent` returns a fake agent whose
 *   `generate` resolves a fixed structured output. The agentic engine's
 *   validation / normalization / grant mapping all run for real.
 */

const mocks = vi.hoisted(() => ({
  // Oneshot pipeline seams
  analyzeContentMock: vi.fn(),
  retrieveSearchCandidatesMock: vi.fn(),
  evaluateCandidatesMock: vi.fn(),
  generateCategorySuggestionMock: vi.fn(),
  // Grant resolution seam (shared by both engines)
  resolveParentGrantMock: vi.fn(),
  // Agent seam
  getAgentMock: vi.fn(),
  agentGenerateMock: vi.fn(),
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

// Mock login required — always authenticate as the fixture user
// (authentication enforcement itself is covered by suggest-path-integration.spec.ts)
vi.mock('~/server/middlewares/login-required', () => ({
  default: () => (req: Request, _res: Response, next: NextFunction) => {
    Object.assign(req, { user: mockUser });
    next();
  },
}));

// Fixed config: AI enabled, 'oneshot' as the configured default engine
// (mirrors the real config-definition defaults), plus the agentic engine's
// operational settings read per request.
vi.mock('~/server/service/config-manager', () => ({
  configManager: {
    getConfig: (key: string) => {
      switch (key) {
        case 'app:aiEnabled':
          return true;
        case 'openai:serviceType':
          return 'openai';
        case 'security:disableUserPages':
          return false;
        case 'aiTools:suggestPathEngine':
          return 'oneshot';
        case 'aiTools:suggestPathAgenticSearchLimit':
          return 5;
        case 'aiTools:suggestPathAgenticChildListingLimit':
          return 5;
        case 'aiTools:suggestPathAgenticTimeoutMs':
          return 60_000;
        // Read by the agentic engine's provider-options resolution (the REAL
        // getEffectiveDefaultModelKey / getProviderOptionsForModel modules run
        // against this mock). The effective model comes from the AVAILABLE set,
        // so the provider must be enabled and hold an API key as well.
        case 'openai:reasoningEffort:suggestPathAgent':
          return '';
        case 'ai:allowedModels':
          return [
            { provider: 'openai', modelId: 'test-model', isDefault: true },
          ];
        case 'ai:providers':
          return { openai: { enabled: true } };
        case 'ai:providerApiKeys':
          return { openai: 'test-api-key' };
        default:
          return undefined;
      }
    },
  },
}));

// Plain async stubs (not vi.fn): they must survive vi.resetAllMocks() in
// beforeEach, and no test asserts on their calls.
vi.mock('~/server/models/user-group-relation', () => ({
  default: {
    findAllUserGroupIdsRelatedToUser: async () => [],
  },
}));

vi.mock(
  '~/features/external-user-group/server/models/external-user-group-relation',
  () => ({
    default: {
      findAllUserGroupIdsRelatedToUser: async () => [],
    },
  }),
);

vi.mock('../services/analyze-content', () => ({
  analyzeContent: mocks.analyzeContentMock,
}));

vi.mock('../services/retrieve-search-candidates', () => ({
  retrieveSearchCandidates: mocks.retrieveSearchCandidatesMock,
}));

vi.mock('../services/evaluate-candidates', () => ({
  evaluateCandidates: mocks.evaluateCandidatesMock,
}));

vi.mock('../services/generate-category-suggestion', () => ({
  generateCategorySuggestion: mocks.generateCategorySuggestionMock,
}));

vi.mock('../services/resolve-parent-grant', () => ({
  resolveParentGrant: mocks.resolveParentGrantMock,
}));

vi.mock('~/features/mastra/server/services/mastra-modules', () => ({
  mastra: { getAgent: mocks.getAgentMock },
}));

// --- Fixtures --------------------------------------------------------------

// Oneshot pipeline outputs. Values are distinct from the agentic fixture so
// the provenance of each response (which engine produced it) is unambiguous.
const oneshotAnalysis = {
  keywords: ['React', 'hooks'],
  informationType: 'stock' as const,
};

const oneshotCandidates = [
  {
    pagePath: '/tech-notes/React/hooks-guide',
    snippet: 'React hooks overview',
    score: 10,
  },
];

const oneshotEvaluated = [
  {
    path: '/tech-notes/React/',
    label: 'Save near related pages',
    description: 'Oneshot-evaluated destination for React content.',
  },
];

const oneshotCategory = {
  type: 'category',
  path: '/tech-notes/',
  label: 'Save under category',
  description: 'Top-level category: tech-notes',
  grant: 1,
};

// Structured output the fake agent resolves — consumed by the real agentic
// engine (type-guard validation, path normalization, grant resolution).
const agenticOutput = {
  informationType: 'stock',
  suggestions: [
    {
      path: '/agentic/explored/',
      label: 'Save under explored area',
      description: 'The agent found closely related pages in this area.',
    },
    {
      path: '/agentic/alternative/',
      label: 'Save under alternative area',
      description: 'A secondary fit found during exploration.',
    },
  ],
} satisfies AgenticEngineOutput;

const expectedMemoSuggestion = {
  type: 'memo',
  path: '/user/alice/memo/',
  label: 'Save as memo',
  description: 'Save to your personal memo area',
  grant: 4,
};

describe('POST /suggest-path route integration — engine selection', () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.resetAllMocks();

    // Oneshot pipeline defaults — full success
    mocks.analyzeContentMock.mockResolvedValue(oneshotAnalysis);
    mocks.retrieveSearchCandidatesMock.mockResolvedValue(oneshotCandidates);
    mocks.evaluateCandidatesMock.mockResolvedValue(oneshotEvaluated);
    mocks.generateCategorySuggestionMock.mockResolvedValue(oneshotCategory);
    mocks.resolveParentGrantMock.mockResolvedValue(1);

    // Agent seam default — the registry returns a fake agent whose generate
    // resolves the fixed structured output
    mocks.getAgentMock.mockReturnValue({ generate: mocks.agentGenerateMock });
    mocks.agentGenerateMock.mockResolvedValue({ object: agenticOutput });

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

    // Import and mount the handler factory with the real middleware chain
    const { suggestPathHandlersFactory } = await import('../routes/apiv3');
    const crowi = mock<Crowi>({
      searchService: { searchKeyword: vi.fn() },
    });
    app.post('/suggest-path', suggestPathHandlersFactory(crowi));
  });

  describe("engine: 'agentic' specified (agent mocked)", () => {
    it('should return 200 with memo first and contract-conformant agentic search suggestions', async () => {
      const response = await request(app)
        .post('/suggest-path')
        .send({ body: 'Document content to explore', engine: 'agentic' })
        .expect(200);

      expect(response.body.suggestions).toEqual([
        expectedMemoSuggestion,
        {
          type: 'search',
          path: '/agentic/explored/',
          label: 'Save under explored area',
          description: 'The agent found closely related pages in this area.',
          grant: 1,
          informationType: 'stock',
        },
        {
          type: 'search',
          path: '/agentic/alternative/',
          label: 'Save under alternative area',
          description: 'A secondary fit found during exploration.',
          grant: 1,
          informationType: 'stock',
        },
      ]);
    });

    it('should resolve the grant per suggested path through the grant seam', async () => {
      mocks.resolveParentGrantMock
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(4);

      const response = await request(app)
        .post('/suggest-path')
        .send({ body: 'Document content', engine: 'agentic' })
        .expect(200);

      expect(mocks.resolveParentGrantMock).toHaveBeenCalledWith(
        '/agentic/explored/',
      );
      expect(mocks.resolveParentGrantMock).toHaveBeenCalledWith(
        '/agentic/alternative/',
      );
      const searchSuggestions = response.body.suggestions.filter(
        (s: { type: string }) => s.type === 'search',
      );
      expect(searchSuggestions.map((s: { grant: number }) => s.grant)).toEqual([
        1, 4,
      ]);
    });

    it('should normalize agent-proposed paths to trailing-slash parent-directory form', async () => {
      mocks.agentGenerateMock.mockResolvedValue({
        object: {
          informationType: 'stock',
          suggestions: [
            {
              path: 'agentic/no-slashes',
              label: 'Missing slashes',
              description: 'Path proposed without leading/trailing slashes.',
            },
          ],
        } satisfies AgenticEngineOutput,
      });

      const response = await request(app)
        .post('/suggest-path')
        .send({ body: 'Document content', engine: 'agentic' })
        .expect(200);

      const searchSuggestion = response.body.suggestions.find(
        (s: { type: string }) => s.type === 'search',
      );
      expect(searchSuggestion.path).toBe('/agentic/no-slashes/');
    });

    it('should apply a flow classification to search suggestions only', async () => {
      mocks.agentGenerateMock.mockResolvedValue({
        object: {
          informationType: 'flow',
          suggestions: [
            {
              path: '/diary/2026/',
              label: 'Save under diary',
              description: 'Time-bound content fits the diary tree.',
            },
          ],
        } satisfies AgenticEngineOutput,
      });

      const response = await request(app)
        .post('/suggest-path')
        .send({ body: 'Meeting log content', engine: 'agentic' })
        .expect(200);

      const [memoSuggestion, searchSuggestion] = response.body.suggestions;
      expect(searchSuggestion.informationType).toBe('flow');
      expect(memoSuggestion).not.toHaveProperty('informationType');
    });

    it('should retrieve the suggestPathAgent from the registry and not run the oneshot pipeline', async () => {
      await request(app)
        .post('/suggest-path')
        .send({ body: 'Document content', engine: 'agentic' })
        .expect(200);

      expect(mocks.getAgentMock).toHaveBeenCalledWith('suggestPathAgent');
      expect(mocks.agentGenerateMock).toHaveBeenCalledTimes(1);
      expect(mocks.analyzeContentMock).not.toHaveBeenCalled();
      expect(mocks.retrieveSearchCandidatesMock).not.toHaveBeenCalled();
      expect(mocks.evaluateCandidatesMock).not.toHaveBeenCalled();
      expect(mocks.generateCategorySuggestionMock).not.toHaveBeenCalled();
    });
  });

  describe('engine: invalid value', () => {
    it('should return 400 with validation errors', async () => {
      const response = await request(app)
        .post('/suggest-path')
        .send({ body: 'Document content', engine: 'invalid-engine' })
        .expect(400);

      expect(response.body.errors).toBeDefined();
      expect(response.body.errors.length).toBeGreaterThan(0);
    });

    it('should not execute any engine when the engine value is rejected', async () => {
      await request(app)
        .post('/suggest-path')
        .send({ body: 'Document content', engine: 'invalid-engine' })
        .expect(400);

      expect(mocks.getAgentMock).not.toHaveBeenCalled();
      expect(mocks.agentGenerateMock).not.toHaveBeenCalled();
      expect(mocks.analyzeContentMock).not.toHaveBeenCalled();
    });
  });

  describe('engine unspecified', () => {
    it('should serve the request through the oneshot pipeline (configured default)', async () => {
      const response = await request(app)
        .post('/suggest-path')
        .send({ body: 'Content about React hooks' })
        .expect(200);

      expect(mocks.analyzeContentMock).toHaveBeenCalledWith(
        'Content about React hooks',
      );
      expect(response.body.suggestions).toEqual([
        expectedMemoSuggestion,
        {
          type: 'search',
          path: '/tech-notes/React/',
          label: 'Save near related pages',
          description: 'Oneshot-evaluated destination for React content.',
          grant: 1,
          informationType: 'stock',
        },
        oneshotCategory,
      ]);
    });

    it('should not invoke the agentic engine when engine is unspecified', async () => {
      await request(app)
        .post('/suggest-path')
        .send({ body: 'Content about React hooks' })
        .expect(200);

      expect(mocks.getAgentMock).not.toHaveBeenCalled();
      expect(mocks.agentGenerateMock).not.toHaveBeenCalled();
    });
  });
});
