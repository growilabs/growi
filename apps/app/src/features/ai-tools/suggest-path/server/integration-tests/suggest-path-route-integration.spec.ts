import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

import type { AgenticEngineOutput } from '../services/engines/agentic-output-schema';

/**
 * Route integration for engine selection: requests travel through the real
 * middleware chain (aiReadyGuard + validator + apiV3FormValidator + handler),
 * the real orchestrator + availability-based engine selection, and the REAL
 * agentic engine adapter.
 *
 * Engine selection is by runtime availability: agentic when the Mastra AI
 * stack has at least one available model. When the stack is NOT configured the
 * aiReadyGuard rejects the request with 501 before any engine runs — there is
 * no legacy fallback engine (the Elasticsearch-only fallback is planned; see
 * the roadmap in the suggest-path-agentic spec). Each describe block
 * reproduces one availability state through the config seam (`ai:providers`
 * etc.).
 *
 * Only process-external seams are mocked:
 * - resolveParentGrant (mongoose-backed)
 * - the Mastra registry: its transitive `@mastra/core/agent` import cannot
 *   load under vitest (pnpm `@mastra/core>p-map` override — see tasks.md
 *   Implementation Notes), so `mastra.getAgent` returns a fake agent whose
 *   `generate` resolves a fixed structured output. The agentic engine's
 *   validation / normalization / grant mapping all run for real.
 */

const mocks = vi.hoisted(() => ({
  // Grant resolution seam (mongoose-backed)
  resolveParentGrantMock: vi.fn(),
  // Agent seam
  getAgentMock: vi.fn(),
  agentGenerateMock: vi.fn(),
}));

// Per-test config overrides layered over the fixed defaults below; reset in
// beforeEach. Clearing the AI provider settings is how a test reproduces the
// "Mastra AI not configured" availability state.
const configState = vi.hoisted(() => ({
  overrides: {} as Record<string, unknown>,
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
// (authentication enforcement itself is covered by the route handler spec)
vi.mock('~/server/middlewares/login-required', () => ({
  default: () => (req: Request, _res: Response, next: NextFunction) => {
    Object.assign(req, { user: mockUser });
    next();
  },
}));

// Fixed config defaults: AI enabled with an available provider/model (so the
// REAL is-ai-configured module reads the Mastra AI stack as configured),
// plus the agentic engine's operational settings read per request.
vi.mock('~/server/service/config-manager', () => ({
  configManager: {
    getConfig: (key: string) => {
      if (key in configState.overrides) {
        return configState.overrides[key];
      }
      switch (key) {
        case 'app:aiEnabled':
          return true;
        case 'security:disableUserPages':
          return false;
        case 'aiTools:suggestPathAgenticSearchLimit':
          return 5;
        case 'aiTools:suggestPathAgenticChildListingLimit':
          return 5;
        case 'aiTools:suggestPathAgenticTimeoutMs':
          return 60_000;
        // Read by the availability check (is-ai-configured) and the agentic
        // engine's provider-options resolution (the REAL
        // getEffectiveDefaultModelKey / getProviderOptionsForModel modules run
        // against this mock). The effective model comes from the AVAILABLE set,
        // so the provider must be enabled and hold an API key as well.
        case 'ai:providerOptions:suggestPathAgent':
          return null;
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

vi.mock('../services/resolve-parent-grant', () => ({
  resolveParentGrant: mocks.resolveParentGrantMock,
}));

vi.mock('~/features/mastra/server/services/mastra-modules', () => ({
  mastra: { getAgent: mocks.getAgentMock },
}));

// Inert logger: keeps the suite runnable where @growi/logger has no build
// output (nothing asserts on logging here).
vi.mock('~/utils/logger', () => ({
  default: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

// --- Fixtures --------------------------------------------------------------

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
  const buildApp = async (): Promise<express.Application> => {
    const app = express();
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
    // (aiReadyGuard included), so the not-configured -> 501 gate is exercised.
    const { suggestPathHandlersFactory } = await import('../routes/apiv3');
    const crowi = mock<Crowi>({
      searchService: { searchKeyword: vi.fn() },
    });
    app.post('/suggest-path', suggestPathHandlersFactory(crowi));
    return app;
  };

  // Reproduces the "Mastra AI not configured" availability state: no enabled
  // provider and no API key -> the available model set is empty.
  const unconfigureMastraAi = () => {
    configState.overrides['ai:providers'] = {};
    configState.overrides['ai:providerApiKeys'] = {};
  };

  beforeEach(() => {
    vi.resetAllMocks();
    configState.overrides = {};

    mocks.resolveParentGrantMock.mockResolvedValue(1);

    // Agent seam default — the registry returns a fake agent whose generate
    // resolves the fixed structured output
    mocks.getAgentMock.mockReturnValue({ generate: mocks.agentGenerateMock });
    mocks.agentGenerateMock.mockResolvedValue({ object: agenticOutput });
  });

  describe('Mastra AI configured (agentic engine selected, agent mocked)', () => {
    it('should return 200 with memo first and contract-conformant agentic search suggestions', async () => {
      const app = await buildApp();

      const response = await request(app)
        .post('/suggest-path')
        .send({ body: 'Document content to explore' })
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
      const app = await buildApp();

      const response = await request(app)
        .post('/suggest-path')
        .send({ body: 'Document content' })
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
      const app = await buildApp();

      const response = await request(app)
        .post('/suggest-path')
        .send({ body: 'Document content' })
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
      const app = await buildApp();

      const response = await request(app)
        .post('/suggest-path')
        .send({ body: 'Meeting log content' })
        .expect(200);

      const [memoSuggestion, searchSuggestion] = response.body.suggestions;
      expect(searchSuggestion.informationType).toBe('flow');
      expect(memoSuggestion).not.toHaveProperty('informationType');
    });

    it('should retrieve the suggestPathAgent from the registry', async () => {
      const app = await buildApp();

      await request(app)
        .post('/suggest-path')
        .send({ body: 'Document content' })
        .expect(200);

      expect(mocks.getAgentMock).toHaveBeenCalledWith('suggestPathAgent');
      expect(mocks.agentGenerateMock).toHaveBeenCalledTimes(1);
    });

    it('should ignore the removed engine field sent by legacy clients', async () => {
      const app = await buildApp();

      const response = await request(app)
        .post('/suggest-path')
        .send({ body: 'Document content', engine: 'oneshot' })
        .expect(200);

      // Availability decides (agentic here); the legacy field neither
      // selects an engine nor fails validation.
      expect(mocks.agentGenerateMock).toHaveBeenCalledTimes(1);
      expect(response.body.suggestions[0]).toEqual(expectedMemoSuggestion);
    });
  });

  describe('Mastra AI not configured', () => {
    it('should reject with 501 before any engine runs', async () => {
      unconfigureMastraAi();
      const app = await buildApp();

      await request(app)
        .post('/suggest-path')
        .send({ body: 'Document content' })
        .expect(501);

      expect(mocks.getAgentMock).not.toHaveBeenCalled();
      expect(mocks.agentGenerateMock).not.toHaveBeenCalled();
    });
  });
});
