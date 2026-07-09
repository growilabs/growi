import type { RequestContext } from '@mastra/core/request-context';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import { limitedSearchTool } from '~/features/mastra/server/services/mastra-modules/agents/suggest-path/limited-search-tool';
import type { SuggestPathRequestContextShape } from '~/features/mastra/server/services/mastra-modules/agents/suggest-path/request-context';
import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

import type { AgenticEngineOutput } from '../services/engines/agentic-output-schema';

/**
 * Agentic-path integration for budget exhaustion and wrap-up (task 6.2,
 * design Testing Strategy Integration #3): a mocked agent goes through
 * `limit_exceeded` and still returns its structured output, and the HTTP
 * response carries the memo suggestion plus informationType-bearing search
 * suggestions.
 *
 * What runs for REAL: route middleware chain, orchestrator + dispatcher,
 * agentic engine (per-request RequestContext + searchBudget built from
 * config), limitedSearchTool (budget enforcement), and fullTextSearchTool
 * (delegation target). Only process-external seams are mocked:
 *
 * - the Mastra registry barrel (its transitive `@mastra/core/agent` import
 *   cannot load under vitest — pnpm `@mastra/core>p-map` override, see
 *   tasks.md Implementation Notes): `mastra.getAgent` returns a fake agent
 *   whose `generate` SIMULATES the agent loop by actually CALLING the real
 *   `limitedSearchTool.execute` with the requestContext the engine passed,
 *   consuming the real budget until it observes `limit_exceeded`, then
 *   resolving the structured output (the Requirement 3.2 wrap-up behavior)
 * - `searchService.searchKeyword` (Elasticsearch boundary) on the Crowi mock
 *   — the inner seam the REAL fullTextSearchTool delegates to
 * - resolveParentGrant and the user-group models (mongoose-backed)
 * - the oneshot pipeline services (harness parity with the 6.1 spec; the
 *   agentic path must leave them untouched, which 6.1 already asserts)
 *
 * NOTE: `limitedSearchTool` is imported DIRECTLY from its module — NOT via
 * the `agents/suggest-path` barrel, which also loads suggest-path-agent.ts
 * -> `@mastra/core/agent` and would fail to import under vitest. The direct
 * module only pulls in `@mastra/core/tools` and fullTextSearchTool, both
 * vitest-safe.
 */

const mocks = vi.hoisted(() => ({
  // Oneshot pipeline seams — must stay idle on the agentic path; mocked so
  // the module graph never loads the real LLM-calling services.
  analyzeContentMock: vi.fn(),
  retrieveSearchCandidatesMock: vi.fn(),
  evaluateCandidatesMock: vi.fn(),
  generateCategorySuggestionMock: vi.fn(),
  // Grant resolution seam (mongoose-backed)
  resolveParentGrantMock: vi.fn(),
  // Agent seam
  getAgentMock: vi.fn(),
  agentGenerateMock: vi.fn(),
  // Inner search seam: the REAL fullTextSearchTool.execute delegates here
  searchKeywordMock: vi.fn(),
  // Per-request search budget limit served by the config mock
  SEARCH_LIMIT: 2,
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

// Fixed config: AI enabled, plus the agentic engine's operational settings
// read per request. The search limit is the scenario's pivot: the engine
// builds the per-request budget from it, and the budget — not the mock — is
// what stops the simulated agent loop.
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
          return mocks.SEARCH_LIMIT;
        case 'aiTools:suggestPathAgenticChildListingLimit':
          return 5;
        case 'aiTools:suggestPathAgenticTimeoutMs':
          return 60_000;
        // Read by the agentic engine's provider-options resolution (the
        // REAL resolveEffectiveModelId / getProviderOptionsForModel modules
        // run against this mock, so the allow-list must be non-empty).
        case 'openai:reasoningEffort:suggestPathAgent':
          return '';
        case 'ai:allowedModels':
          return [{ modelId: 'test-model', isDefault: true }];
        case 'ai:provider':
          return 'openai';
        default:
          return undefined;
      }
    },
  },
}));

// Plain async stubs (not vi.fn): they must survive vi.resetAllMocks() in
// beforeEach, and no test asserts on their calls. Both the route handler and
// the REAL fullTextSearchTool resolve user groups through these models.
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

// Hits served by the mocked searchService.searchKeyword in the shape the ES
// delegator produces; the REAL fullTextSearchTool maps them to tool hits
// (pageId / pagePath / snippet). One distinct hit per search so the
// passthrough is observable per call.
const searchResultPages = [
  {
    _id: 'page-sprint-notes',
    _source: { path: '/dev/sprint-notes/2026-06' },
    _highlight: { body: ['sprint retro <em>notes</em>'] },
  },
  {
    _id: 'page-daily-log',
    _source: { path: '/dev/daily-log/2026-06-11' },
    _highlight: { body: ['daily <em>log</em> entry'] },
  },
];

// Structured output the fake agent resolves AFTER observing limit_exceeded —
// the suggestion paths are parents of the explored hits, i.e. suggestions
// built from the collected information (Requirement 1.4 / 3.2).
const agenticOutput = {
  informationType: 'flow',
  suggestions: [
    {
      path: '/dev/sprint-notes/',
      label: 'Save under sprint notes',
      description: 'Time-bound sprint records are collected here.',
    },
    {
      path: '/dev/daily-log/',
      label: 'Save under daily log',
      description: 'Fits the chronological log tree found during exploration.',
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

// --- Agent-loop simulation helpers ------------------------------------------

// Discriminated union mirroring limitedSearchTool's output schema, defined
// locally so the loop can narrow on `result` without casts (same pattern as
// limited-search-tool.spec.ts). The Mastra input-validation envelope is not
// modeled: every simulated query is schema-valid.
type LimitedSearchToolResult =
  | {
      result: 'ok';
      hits: Array<{ pageId: string; pagePath: string; snippet?: string }>;
      totalCount: number;
    }
  | { result: 'error' | 'context_error' | 'limit_exceeded'; reason: string };

type SuggestPathRequestContext = RequestContext<SuggestPathRequestContextShape>;

// Invoke the real wrapper tool the way the mastra runtime does:
// `(inputData, { requestContext, ... })`. The runtime's `execute` signature
// is intentionally loose (`unknown` input / output), so a single `as never`
// per arg is unavoidable here (same pattern as limited-search-tool.spec.ts).
const invokeLimitedSearch = async (
  query: string,
  requestContext: SuggestPathRequestContext,
): Promise<LimitedSearchToolResult> => {
  // biome-ignore lint/style/noNonNullAssertion: createTool always wires execute
  const result = await limitedSearchTool.execute!(
    { query } as never,
    { requestContext } as never,
  );
  return result as LimitedSearchToolResult;
};

// Ceiling for the simulated agent loop: enough attempts to observe the
// budget's wrap-up signal (SEARCH_LIMIT ok results + 1 blocked attempt). If
// the budget never signals limit_exceeded, the loop stops here and the
// captured-output assertions fail visibly instead of looping forever.
const MAX_SEARCH_ATTEMPTS = mocks.SEARCH_LIMIT + 1;

describe('POST /suggest-path agentic path integration — budget exhaustion and wrap-up', () => {
  let app: express.Application;
  let capturedToolOutputs: LimitedSearchToolResult[];
  let capturedRequestContext: SuggestPathRequestContext | undefined;

  beforeEach(async () => {
    vi.resetAllMocks();

    capturedToolOutputs = [];
    capturedRequestContext = undefined;

    mocks.resolveParentGrantMock.mockResolvedValue(1);

    // The fake agent simulates the agent loop with the REAL limitedSearchTool
    // and the REAL budget the engine placed in the requestContext: it keeps
    // searching until the budget signals limit_exceeded, then wraps up and
    // resolves its structured output from the collected information.
    mocks.getAgentMock.mockReturnValue({ generate: mocks.agentGenerateMock });
    mocks.agentGenerateMock.mockImplementation(
      async (
        _prompt: string,
        options: { requestContext: SuggestPathRequestContext },
      ) => {
        capturedRequestContext = options.requestContext;
        for (let attempt = 1; attempt <= MAX_SEARCH_ATTEMPTS; attempt++) {
          // biome-ignore lint/performance/noAwaitInLoops: the agent loop is sequential by contract — each search consumes budget and the loop stops on limit_exceeded
          const output = await invokeLimitedSearch(
            `agentic-query-${attempt}`,
            options.requestContext,
          );
          capturedToolOutputs = [...capturedToolOutputs, output];
          if (output.result === 'limit_exceeded') {
            break;
          }
        }
        return { object: agenticOutput };
      },
    );

    // Inner search seam: each delegated search returns one distinct hit. The
    // trailing default is defensive only — with correct budget enforcement a
    // third search never reaches the search service.
    mocks.searchKeywordMock
      .mockResolvedValueOnce([
        { data: [searchResultPages[0]], meta: { total: 1 } },
        'elasticsearch',
      ])
      .mockResolvedValueOnce([
        { data: [searchResultPages[1]], meta: { total: 1 } },
        'elasticsearch',
      ])
      .mockResolvedValue([{ data: [], meta: { total: 0 } }, 'elasticsearch']);

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

    // Import and mount the handler factory with the real middleware chain.
    // The Crowi mock's searchService is what the engine puts into the
    // requestContext, so the REAL fullTextSearchTool reads this exact seam.
    const { suggestPathHandlersFactory } = await import('../routes/apiv3');
    const crowi = mock<Crowi>({
      searchService: {
        searchKeyword: mocks.searchKeywordMock,
        isElasticsearchEnabled: true,
      },
    });
    app.post('/suggest-path', suggestPathHandlersFactory(crowi));
  });

  it('returns memo first plus informationType-bearing search suggestions after the agent wraps up on limit_exceeded', async () => {
    const response = await request(app)
      .post('/suggest-path')
      .send({ body: 'Daily standup log for the sprint', engine: 'agentic' })
      .expect(200);

    // The wrap-up signal was actually delivered to the agent in THIS request
    // (Requirement 3.2 premise: the budget ran out mid-exploration)...
    expect(capturedToolOutputs[capturedToolOutputs.length - 1]).toEqual({
      result: 'limit_exceeded',
      reason: expect.any(String),
    });

    // ...and the response still carries the full suggestion set generated
    // from the information collected before the cut-off: memo first
    // (Requirement 4.3), then the agent's suggestions as type 'search', each
    // carrying the classified informationType (Requirements 2.3, 1.4).
    expect(response.body.suggestions).toEqual([
      expectedMemoSuggestion,
      {
        type: 'search',
        path: '/dev/sprint-notes/',
        label: 'Save under sprint notes',
        description: 'Time-bound sprint records are collected here.',
        grant: 1,
        informationType: 'flow',
      },
      {
        type: 'search',
        path: '/dev/daily-log/',
        label: 'Save under daily log',
        description:
          'Fits the chronological log tree found during exploration.',
        grant: 1,
        informationType: 'flow',
      },
    ]);
  });

  it('lets the real budget gate delegation: limit ok results, then limit_exceeded without another search', async () => {
    await request(app)
      .post('/suggest-path')
      .send({ body: 'Daily standup log for the sprint', engine: 'agentic' })
      .expect(200);

    // The agent observed exactly SEARCH_LIMIT real search results (delegated
    // through the REAL fullTextSearchTool to the mocked search service),
    // then the budget cut off the next attempt with limit_exceeded.
    expect(capturedToolOutputs).toEqual([
      {
        result: 'ok',
        hits: [
          {
            pageId: 'page-sprint-notes',
            pagePath: '/dev/sprint-notes/2026-06',
            snippet: 'sprint retro <em>notes</em>',
          },
        ],
        totalCount: 1,
      },
      {
        result: 'ok',
        hits: [
          {
            pageId: 'page-daily-log',
            pagePath: '/dev/daily-log/2026-06-11',
            snippet: 'daily <em>log</em> entry',
          },
        ],
        totalCount: 1,
      },
      { result: 'limit_exceeded', reason: expect.any(String) },
    ]);

    // The blocked third attempt never reached the search service, and each
    // delegated call carried the requesting user — the delegate read user /
    // searchService from the SAME request context the engine built, so
    // permission filtering stays with the grant-aware search path.
    expect(mocks.searchKeywordMock).toHaveBeenCalledTimes(mocks.SEARCH_LIMIT);
    expect(mocks.searchKeywordMock).toHaveBeenNthCalledWith(
      1,
      'agentic-query-1',
      null,
      mockUser,
      [],
      { limit: 10, sort: 'relationScore', order: 'desc' },
    );
    expect(mocks.searchKeywordMock).toHaveBeenNthCalledWith(
      2,
      'agentic-query-2',
      null,
      mockUser,
      [],
      { limit: 10, sort: 'relationScore', order: 'desc' },
    );
  });

  it('builds the per-request budget from config and records only executed queries', async () => {
    await request(app)
      .post('/suggest-path')
      .send({ body: 'Daily standup log for the sprint', engine: 'agentic' })
      .expect(200);

    // The budget object the engine built is observable through the
    // requestContext handed to the agent: the limit comes from the
    // aiTools:suggestPathAgenticSearchLimit config (read per request), every
    // executed search was counted, and the blocked third query was NOT
    // recorded in the trace.
    expect(capturedRequestContext).toBeDefined();
    expect(capturedRequestContext?.get('searchBudget')).toEqual({
      limit: mocks.SEARCH_LIMIT,
      used: mocks.SEARCH_LIMIT,
      queries: ['agentic-query-1', 'agentic-query-2'],
    });
  });
});
