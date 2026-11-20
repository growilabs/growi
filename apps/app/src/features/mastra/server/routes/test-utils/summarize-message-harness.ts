import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IUserHasId } from '@growi/core';
import type { RequestContext } from '@mastra/core/request-context';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';

import { limitedGetPageContentTool } from '../../services/mastra-modules/agents/summarize/limited-get-page-content-tool';
import type {
  PageReadBudget,
  SummarizeRequestContextShape,
} from '../../services/mastra-modules/agents/summarize/request-context';

/**
 * Shared harness for the POST /summary handler specs, driven over HTTP.
 *
 * What runs for REAL: the route's middleware chain (validator +
 * apiV3FormValidator), the handler, limitedGetPageContentTool ->
 * getPageContentTool (budget enforcement and body slicing), and the `ai` UI
 * message stream piped to the response.
 *
 * Mocked seams (tasks.md "LLMテストダブルの共通方針"):
 * - the Mastra registry barrel (`@mastra/core/agent` cannot load under
 *   vitest): the fake summarizeAgent's `stream()` simulates the agent loop by
 *   CALLING the real limitedGetPageContentTool with the requestContext the
 *   route built, until hasMore === false or limit_exceeded
 * - `@mastra/ai-sdk` toAISdkStream: relays the fake agent's pre-built UI
 *   chunks (tool-call / tool-result / final text)
 * - the Page model: an in-memory `Page` registered on mongoose whose
 *   viewer-filtered finders return null for pages the viewer cannot see
 * - model-key resolution, auth middlewares, and the metrics counter
 */

// Loaded in vi.hoisted so it exists before any factory below runs; the specs
// import the same module instance.
const { mocks } = await vi.hoisted(() => import('./summarize-message-mocks'));

vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser:
    () => (_req: Request, _res: Response, next: NextFunction) =>
      next(),
}));

vi.mock('~/server/middlewares/login-required', () => ({
  default: () => (req: Request, _res: Response, next: NextFunction) => {
    Object.assign(req, { user: mocks.currentUser });
    next();
  },
}));

vi.mock('~/server/middlewares/add-activity', () => ({
  generateAddActivityMiddleware:
    () => (_req: Request, res: Response, next: NextFunction) => {
      mocks.addActivity();
      if (mocks.activityBegun) {
        res.locals.activity = { _id: 'activity-id' };
      }
      next();
    },
}));

vi.mock('~/server/service/activity/pending-activity-context', () => ({
  set: vi.fn(),
  take: mocks.takeActivityContext,
  clear: vi.fn(),
}));

vi.mock('~/server/service/activity/record-failsafe-attempt', () => ({
  recordFailsafeAttempt: mocks.recordFailsafeAttempt,
}));

// The real usage meter, writing through a mocked recorder. The barrel also
// loads the public route and Prisma models.
vi.mock('~/features/ai-usage/server', async () => {
  const { createUsageMeter } = await import(
    '~/features/ai-usage/server/services/usage-meter'
  );
  return { createUsageMeter };
});
vi.mock('~/features/ai-usage/server/services/record-ai-usage', () => ({
  recordAiUsage: mocks.recordAiUsage,
}));

vi.mock('~/features/mastra/server/services/mastra-modules', () => ({
  mastra: { getAgent: mocks.getAgent },
}));

vi.mock('@mastra/ai-sdk', () => ({
  toAISdkStream: (stream: {
    uiChunks: unknown[];
    uiStream?: ReadableStream<unknown>;
  }) =>
    stream.uiStream ??
    new ReadableStream({
      start(controller) {
        for (const chunk of stream.uiChunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    }),
}));

vi.mock(
  '~/features/mastra/server/services/ai-sdk-modules/llm-providers/effective-model-key',
  () => ({ resolveEffectiveModelKey: mocks.resolveEffectiveModelKey }),
);
vi.mock(
  '~/features/mastra/server/services/ai-sdk-modules/resolve-provider-options',
  () => ({ getProviderOptionsForModel: () => ({}) }),
);

vi.mock(
  '~/features/opentelemetry/server/custom-metrics/ai-summarize-metrics',
  () => ({
    incrementAiSummarizeGeneratedCount: mocks.incrementCount,
  }),
);

// getPageContentTool populates the revision to read its body.
vi.mock('~/server/models/obsolete-page', () => ({
  populateDataToShowRevision: (page: { _id: unknown; revision: unknown }) => {
    page.revision = {
      _id: page.revision,
      body: mocks.bodiesByPageId.get(String(page._id)),
    };
    return Promise.resolve(page);
  },
}));

vi.mock('~/utils/logger', () => ({
  default: () => mocks.logger,
}));

// --- Fixtures --------------------------------------------------------------

const { ObjectId } = mongoose.Types;

type FakePage = {
  _id: mongoose.Types.ObjectId;
  path: string;
  revision: mongoose.Types.ObjectId | null;
  body: string;
  // null = public
  viewableOnlyBy: string | null;
};

export const viewer = mock<IUserHasId>({
  _id: new ObjectId().toString(),
  username: 'viewer',
  lang: 'en_US',
});
const otherUser = mock<IUserHasId>({
  _id: new ObjectId().toString(),
  username: 'other',
});

export const PAGE_READ_LIMIT = 60_000;
export const MAX_STEPS = 6;

const buildPage = (
  path: string,
  body: string,
  viewableOnlyBy: string | null = null,
): FakePage & { revision: mongoose.Types.ObjectId } => ({
  _id: new ObjectId(),
  path,
  revision: new ObjectId(),
  body,
  viewableOnlyBy,
});

export const shortPage = buildPage(
  '/summarize/short',
  'Short line 1\nShort line 2',
);
// Longer than the character budget so the fake agent loop is cut off by
// limit_exceeded and the first request demonstrably consumes budget.
export const longPage = buildPage(
  '/summarize/long',
  Array.from({ length: 1600 }, (_, i) => `Line ${i + 1} `.padEnd(50, '.')).join(
    '\n',
  ),
);
export const ownerOnlyPage = buildPage(
  '/summarize/owner-only',
  'private body',
  otherUser._id.toString(),
);
export const revisionlessPage: FakePage = {
  ...buildPage('/summarize/revisionless', ''),
  revision: null,
};
const pages = [shortPage, longPage, ownerOnlyPage, revisionlessPage];

const isViewable = (page: FakePage, user: IUserHasId): boolean =>
  page.viewableOnlyBy == null || page.viewableOnlyBy === user._id.toString();

// Returns a fresh unpopulated document shape, as a non-populated query does.
const toDoc = (page: FakePage | undefined, user: IUserHasId) =>
  page != null && isViewable(page, user)
    ? { _id: page._id, path: page.path, revision: page.revision }
    : null;

const registerFakePageModel = (): void => {
  if (mongoose.models.Page != null) return;
  const schema = new mongoose.Schema({});
  schema.statics.findByIdAndViewer = async (id: unknown, user: IUserHasId) => {
    await mocks.pageLookup();
    return toDoc(
      pages.find((page) => page._id.toString() === String(id)),
      user,
    );
  };
  schema.statics.findByPathAndViewer = async (
    path: string,
    user: IUserHasId,
  ) => {
    await mocks.pageLookup();
    return toDoc(
      pages.find((page) => page.path === path),
      user,
    );
  };
  mongoose.model('Page', schema);
};

export const activityContext = {
  userId: viewer._id.toString(),
  username: viewer.username,
  createdAt: new Date(),
};

// What the fake agent reports for its one model call.
export const MODEL_CALL_USAGE = {
  inputTokens: 120,
  outputTokens: 30,
  reasoningTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
};

export const FINAL_TEXT =
  'This page is a test fixture.\n- point one\n- point two\n- point three';

// --- Fake agent loop -------------------------------------------------------

type ToolResult =
  | { result: 'ok'; page: { content?: string; hasMore?: boolean } }
  | { result: string; reason: string };

type SummarizeRequestContext = RequestContext<SummarizeRequestContextShape>;

export type StreamOptions = {
  requestContext: SummarizeRequestContext;
  maxSteps: number;
  prepareStep: (args: { stepNumber: number }) => unknown;
  abortSignal: AbortSignal;
};

export type StreamCall = {
  prompt: unknown;
  options: StreamOptions;
  budgetAtStart: PageReadBudget | undefined;
  toolOutputs: ToolResult[];
};

const MAX_TOOL_CALLS = 10;
const READ_LIMIT = 500;

const invokeTool = async (
  input: { pageId: string; offset?: number },
  requestContext: SummarizeRequestContext,
): Promise<ToolResult> => {
  // biome-ignore lint/style/noNonNullAssertion: createTool always wires execute
  const result = await limitedGetPageContentTool.execute!(
    { ...input, limit: READ_LIMIT } as never,
    { requestContext } as never,
  );
  return result as ToolResult;
};

const isDone = (output: ToolResult): boolean =>
  output.result !== 'ok' || ('page' in output && output.page.hasMore === false);

// First call omits offset (outline), then reads forward READ_LIMIT lines at a
// time — the reading procedure the summarize instructions prescribe.
const runFakeAgentLoop = async (
  pageId: string,
  requestContext: SummarizeRequestContext,
): Promise<ToolResult[]> => {
  const outputs: ToolResult[] = [];
  let offset: number | undefined;
  for (let i = 0; i < MAX_TOOL_CALLS; i++) {
    // biome-ignore lint/performance/noAwaitInLoops: the agent loop is sequential by contract
    const output = await invokeTool({ pageId, offset }, requestContext);
    outputs.push(output);
    if (isDone(output)) break;
    offset = offset == null ? 1 : offset + READ_LIMIT;
  }
  return outputs;
};

const buildUiChunks = (toolOutputs: ToolResult[]): unknown[] => [
  { type: 'start' },
  { type: 'start-step' },
  ...toolOutputs.flatMap((output, i) => [
    {
      type: 'tool-input-available',
      toolCallId: `call-${i}`,
      toolName: 'getPageContentTool',
      input: {},
    },
    { type: 'tool-output-available', toolCallId: `call-${i}`, output },
  ]),
  { type: 'text-start', id: 'text-1' },
  { type: 'text-delta', id: 'text-1', delta: FINAL_TEXT },
  { type: 'text-end', id: 'text-1' },
  { type: 'finish-step' },
  { type: 'finish' },
];

// The fake agent reads whichever page the route's fixed-form prompt names,
// as a real LLM would.
const extractPageId = (prompt: unknown): string => {
  const match = /[0-9a-f]{24}/.exec(JSON.stringify(prompt));
  if (match == null) throw new Error('pageId missing from summarize prompt');
  return match[0];
};

// --- SSE parsing -------------------------------------------------------------

export type UiChunk = { type: string; [key: string]: unknown };

export const parseSse = (text: string): UiChunk[] =>
  text
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('data: '))
    .map((block) => block.slice('data: '.length))
    .filter((data) => data !== '[DONE]')
    .map((data) => JSON.parse(data) as UiChunk);

export const textOf = (chunks: UiChunk[]): string =>
  chunks
    .filter((chunk) => chunk.type === 'text-delta')
    .map((chunk) => chunk.delta)
    .join('');

export const buildStreamResult = (
  uiChunks: unknown[],
  finishReason: string,
) => ({
  uiChunks,
  usage: Promise.resolve({}),
  finishReason: Promise.resolve(finishReason),
  steps: Promise.resolve([]),
});

// A raw request, so a test can disconnect mid-flight (supertest cannot).
export const openSummaryRequest = (server: http.Server): http.ClientRequest => {
  const { port } = server.address() as AddressInfo;
  const clientRequest = http.request({
    port,
    path: '/summary',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });
  clientRequest.on('error', () => {});
  clientRequest.end(JSON.stringify({ pageId: shortPage._id.toString() }));
  return clientRequest;
};

// Merged the way the client merges successive message-metadata chunks.
export const mergedMetadata = (chunks: UiChunk[]): Record<string, unknown> =>
  Object.assign(
    {},
    ...chunks
      .filter((chunk) => chunk.type === 'message-metadata')
      .map((chunk) => chunk.messageMetadata),
  );

// Lets the handler run past a settled await before asserting.
export const flushHandler = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    // biome-ignore lint/performance/noAwaitInLoops: each tick lets the handler advance one await
    await new Promise(setImmediate);
  }
};

// ---------------------------------------------------------------------------

export type SummarizeRouteHarness = {
  readonly app: express.Application;
  readonly streamCalls: readonly StreamCall[];
};

/**
 * Registers the beforeAll/beforeEach hooks that build a fresh app per test,
 * and returns a live view of it.
 */
export const useSummarizeRoute = (): SummarizeRouteHarness => {
  let app: express.Application;
  let streamCalls: StreamCall[] = [];

  beforeAll(() => {
    registerFakePageModel();
    for (const page of pages) {
      mocks.bodiesByPageId.set(page._id.toString(), page.body);
    }
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.takeActivityContext.mockReturnValue(activityContext);
    mocks.recordAiUsage.mockResolvedValue(undefined);
    mocks.resolveEffectiveModelKey.mockReturnValue('openai/test-model');
    mocks.pageLookup.mockResolvedValue(undefined);
    mocks.currentUser = viewer;
    mocks.activityBegun = true;
    streamCalls = [];

    mocks.stream.mockImplementation(
      async (prompt: unknown, options: StreamOptions) => {
        const budget = options.requestContext.get('pageReadBudget');
        const budgetAtStart = budget == null ? undefined : { ...budget };
        const toolOutputs = await runFakeAgentLoop(
          extractPageId(prompt),
          options.requestContext,
        );
        // Stands in for the metered model the real agent resolves.
        options.requestContext.get('usageMeter')?.add(MODEL_CALL_USAGE);
        streamCalls = [
          ...streamCalls,
          { prompt, options, budgetAtStart, toolOutputs },
        ];
        return buildStreamResult(buildUiChunks(toolOutputs), 'stop');
      },
    );
    mocks.getAgent.mockImplementation((id: string) =>
      id === 'summarizeAgent' ? { stream: mocks.stream } : undefined,
    );

    addCustomFunctionToResponse(express);
    app = express();
    app.use(express.json());
    app.use((_req: Request, res: Response, next: NextFunction) => {
      res.on('close', mocks.responseClosed);
      next();
    });
    const { summarizeMessageHandlersFactory } = await import(
      '../summarize-message'
    );
    const crowi = mock<Crowi>({
      events: { activity: { emit: mocks.emitActivity } },
    });
    app.post('/summary', summarizeMessageHandlersFactory(crowi));
  });

  return {
    get app() {
      return app;
    },
    get streamCalls() {
      return streamCalls;
    },
  };
};
