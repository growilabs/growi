// Drives the real post-message handler with the real growiAgent, Mastra Agent,
// Memory (with the shipped title generation config) and UI message stream,
// replacing only the LLM (MockLanguageModelV3), the agent's tools, the HTTP
// response sink and the usage write (recordAiUsage).
import type { IUserHasId } from '@growi/core';
import type { MastraModelConfig } from '@mastra/core/llm';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import type { Request, RequestHandler } from 'express';
import { mock } from 'vitest-mock-extended';

import type { AiUsageEntry } from '~/features/ai-usage/server';
import { buildModelKey } from '~/features/mastra/interfaces/model-key';
import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

import type { LanguageModelV3Usage } from '../services/usage-metering/from-language-model-usage';

const MODEL_KEY = buildModelKey('openai', 'gpt-4o');

const { recordAiUsage, modelHolder, pipeHolder } = vi.hoisted(() => ({
  recordAiUsage: vi.fn<(entry: AiUsageEntry) => Promise<void>>(),
  modelHolder: { current: undefined as MastraModelConfig | undefined },
  pipeHolder: { drained: Promise.resolve() },
}));

vi.mock('~/features/ai-usage/server/services/record-ai-usage', () => ({
  recordAiUsage,
}));
// The barrel also pulls in the public route and Prisma models; only the meter
// and the recorder are reached from the chat path.
vi.mock('~/features/ai-usage/server', async () => {
  const { createUsageMeter } = await import(
    '~/features/ai-usage/server/services/usage-meter'
  );
  return { createUsageMeter, recordAiUsage };
});

vi.mock('../services/ai-sdk-modules/llm-providers/effective-model-key', () => ({
  resolveEffectiveModelKey: () => MODEL_KEY,
}));
vi.mock('../services/ai-sdk-modules/resolve-provider-options', () => ({
  getProviderOptionsForModel: () => ({}),
}));
vi.mock('../services/ai-sdk-modules/resolve-mastra-model', () => ({
  resolveMastraModel: async () => {
    if (modelHolder.current == null) {
      throw new Error('no model planned for this test');
    }
    return modelHolder.current;
  },
}));

// The real memory module (and its shipped generateTitle option) loads through
// growiAgent; only its MongoDB connection is swapped for an in-memory store.
vi.mock('~/server/util/mongoose-utils', () => ({
  getMongoUri: () => 'mongodb://localhost/growi',
}));
vi.mock('@mastra/mongodb', async () => {
  const { InMemoryStore } = await import('@mastra/core/storage');
  return {
    MongoDBStore: class extends InMemoryStore {
      constructor() {
        super();
      }
    },
  };
});
vi.mock('../services/mastra-modules/tools/full-text-search-tool', async () => {
  const { createTool } = await import('@mastra/core/tools');
  const { z } = await import('zod');
  return {
    fullTextSearchTool: createTool({
      id: 'fullTextSearchTool',
      description: 'Search pages',
      inputSchema: z.object({ query: z.string() }),
      execute: async () => ({ pages: [] }),
    }),
  };
});
vi.mock('../services/mastra-modules/tools/get-page-content-tool', async () => {
  const { createTool } = await import('@mastra/core/tools');
  const { z } = await import('zod');
  return {
    getPageContentTool: createTool({
      id: 'getPageContentTool',
      description: 'Read a page',
      inputSchema: z.object({ pageId: z.string() }),
      execute: async () => ({ content: '' }),
    }),
  };
});
vi.mock('../services/mastra-modules', async () => {
  const { growiAgent } = await import(
    '../services/mastra-modules/agents/growi-agent'
  );
  return { mastra: { getAgent: () => growiAgent } };
});

// Read the UI message stream to its end instead of writing it to a socket.
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    pipeUIMessageStreamToResponse: ({
      stream,
    }: {
      stream: ReadableStream<unknown>;
    }) => {
      pipeHolder.drained = (async () => {
        const reader = stream.getReader();
        while (true) {
          // biome-ignore lint/performance/noAwaitInLoops: read sequentially
          const { done } = await reader.read();
          if (done) return;
        }
      })();
    },
  };
});

// The validator chain needs express-validator's runtime; the handler is
// invoked directly, so the chain is irrelevant here.
vi.mock('./post-message-validator', () => ({
  buildPostMessageValidator: () => [],
}));
vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser: () => vi.fn(),
}));
vi.mock('~/server/middlewares/login-required', () => ({
  default: () => vi.fn(),
}));
vi.mock('~/server/middlewares/apiv3-form-validator', () => ({
  apiV3FormValidator: vi.fn(),
}));
vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { postMessageHandlersFactory } from './post-message';

type StreamPart =
  Awaited<
    ReturnType<MockLanguageModelV3['doStream']>
  >['stream'] extends ReadableStream<infer T>
    ? T
    : never;

const TITLE = 'Generated title';

const usageOf = (input: number, output: number): LanguageModelV3Usage => ({
  inputTokens: {
    total: input,
    noCache: input,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: output, text: output, reasoning: undefined },
});

const callUsage = (inputTokens: number, outputTokens: number) => ({
  inputTokens,
  outputTokens,
  reasoningTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
});

// The chat streams a tool call and then an answer; Mastra generates the
// title with a non-streaming call.
const chatSteps: readonly StreamPart[][] = [
  [
    { type: 'stream-start', warnings: [] },
    {
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'fullTextSearchTool',
      input: JSON.stringify({ query: 'growi' }),
    },
    {
      type: 'finish',
      finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
      usage: usageOf(100, 10),
    },
  ],
  [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: 'done' },
    { type: 'text-end', id: 't' },
    {
      type: 'finish',
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: usageOf(200, 20),
    },
  ],
];

const useModel = (): MockLanguageModelV3 => {
  let next = 0;
  const model = new MockLanguageModelV3({
    provider: 'mock',
    modelId: 'mock-model',
    doStream: async () => {
      const chunks = chatSteps[next];
      next += 1;
      if (chunks == null) {
        throw new Error('the model was streamed more times than planned');
      }
      return { stream: simulateReadableStream({ chunks }) };
    },
    doGenerate: () =>
      Promise.resolve({
        content: [{ type: 'text', text: TITLE }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: usageOf(7, 3),
        warnings: [],
      }),
  });
  modelHolder.current = model;
  return model;
};

const getHandler = (): RequestHandler => {
  const handlers = postMessageHandlersFactory(mock<Crowi>());
  return handlers[handlers.length - 1];
};

const postMessage = async (threadId: string): Promise<void> => {
  const user = mock<IUserHasId>({ _id: 'user-1' });
  const req = mock<Request & { user: IUserHasId }>({ user });
  // Assigned after mock() so Mastra sees plain messages, not deep mock proxies.
  req.body = {
    threadId,
    messages: [
      {
        id: '1',
        role: 'user',
        parts: [{ type: 'text', text: 'Find pages about GROWI' }],
      },
    ],
  };
  const res = mock<ApiV3Response>({ headersSent: false });

  await getHandler()(req, res, vi.fn());
  await pipeHolder.drained;
};

const recordsOf = (feature: AiUsageEntry['feature']): AiUsageEntry[] =>
  recordAiUsage.mock.calls
    .map(([entry]) => entry)
    .filter((entry) => entry.feature === feature);

describe('post-message thread title usage metering (Req 2.3)', () => {
  beforeEach(() => {
    recordAiUsage.mockReset();
    recordAiUsage.mockResolvedValue(undefined);
  });

  it('keeps the title generation out of the chat record and records it once as thread-title', async () => {
    useModel();

    await postMessage('123e4567-e89b-12d3-a456-426614174001');
    await vi.waitFor(() => {
      expect(recordsOf('thread-title')).toHaveLength(1);
    });

    expect(recordAiUsage).toHaveBeenCalledTimes(2);
    expect(recordsOf('chat')).toEqual([
      {
        userId: 'user-1',
        feature: 'chat',
        modelKey: MODEL_KEY,
        calls: [callUsage(100, 10), callUsage(200, 20)],
      },
    ]);
    expect(recordsOf('thread-title')).toEqual([
      {
        userId: 'user-1',
        feature: 'thread-title',
        modelKey: MODEL_KEY,
        calls: [callUsage(7, 3)],
      },
    ]);
  });
});
