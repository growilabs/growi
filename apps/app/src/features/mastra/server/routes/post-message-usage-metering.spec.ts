// Drives the real post-message handler with the real growiAgent, Mastra Agent,
// Memory and UI message stream, replacing only the LLM (MockLanguageModelV3),
// the agent's tools, the HTTP response sink and the usage write (recordAiUsage).
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

const { recordAiUsage, loggerWarn, modelHolder, pipeHolder } = vi.hoisted(
  () => ({
    recordAiUsage: vi.fn<(entry: AiUsageEntry) => Promise<void>>(),
    loggerWarn: vi.fn(),
    modelHolder: { current: undefined as MastraModelConfig | undefined },
    pipeHolder: { drained: Promise.resolve() },
  }),
);

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

vi.mock('../services/mastra-modules/memory', async () => {
  const { Memory } = await import('@mastra/memory');
  const { InMemoryStore } = await import('@mastra/core/storage');
  return { memory: new Memory({ storage: new InMemoryStore() }) };
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
    warn: loggerWarn,
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

type Step =
  | { kind: 'tool-call'; usage: LanguageModelV3Usage }
  | { kind: 'text'; text: string; usage: LanguageModelV3Usage }
  | { kind: 'error' };

const usageOf = (input: number, output: number): LanguageModelV3Usage => ({
  inputTokens: {
    total: input,
    noCache: input,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: output, text: output, reasoning: undefined },
});

const toStreamParts = (step: Step): StreamPart[] => {
  if (step.kind === 'error') {
    return [
      { type: 'stream-start', warnings: [] },
      { type: 'error', error: new Error('provider failed') },
    ];
  }
  if (step.kind === 'tool-call') {
    return [
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
        usage: step.usage,
      },
    ];
  }
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: step.text },
    { type: 'text-end', id: 't' },
    {
      type: 'finish',
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: step.usage,
    },
  ];
};

// Each doStream call answers the next planned agent step.
const planModel = (plan: readonly Step[]): MockLanguageModelV3 => {
  let next = 0;
  const model = new MockLanguageModelV3({
    provider: 'mock',
    modelId: 'mock-model',
    doStream: async () => {
      const step = plan[next];
      next += 1;
      if (step == null) {
        throw new Error('the model was called more times than planned');
      }
      return {
        stream: simulateReadableStream({ chunks: toStreamParts(step) }),
      };
    },
  });
  modelHolder.current = model;
  return model;
};

const callUsage = (inputTokens: number, outputTokens: number) => ({
  inputTokens,
  outputTokens,
  reasoningTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
});

const getHandler = (): RequestHandler => {
  const handlers = postMessageHandlersFactory(mock<Crowi>());
  return handlers[handlers.length - 1];
};

const postMessage = async (): Promise<void> => {
  const user = mock<IUserHasId>();
  user._id = mock<IUserHasId['_id']>();
  user._id.toString = () => 'user-1';
  const req = mock<Request & { user: IUserHasId }>({ user });
  // Assigned after mock() so Mastra sees plain messages, not deep mock proxies.
  req.body = {
    threadId: '123e4567-e89b-12d3-a456-426614174000',
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

describe('post-message usage metering (Req 2.1, 2.6)', () => {
  beforeEach(() => {
    recordAiUsage.mockReset();
    loggerWarn.mockReset();
    recordAiUsage.mockResolvedValue(undefined);
    modelHolder.current = undefined;
    pipeHolder.drained = Promise.resolve();
  });

  it('records a multi-step chat with a tool call in between as exactly one record with the calls of every step', async () => {
    planModel([
      { kind: 'tool-call', usage: usageOf(100, 10) },
      { kind: 'text', text: 'done', usage: usageOf(200, 20) },
    ]);

    await postMessage();

    expect(recordAiUsage).toHaveBeenCalledTimes(1);
    expect(recordAiUsage).toHaveBeenCalledWith({
      userId: 'user-1',
      feature: 'chat',
      modelKey: MODEL_KEY,
      calls: [callUsage(100, 10), callUsage(200, 20)],
    });
  });

  it('still records the calls collected before the response failed mid-way', async () => {
    const model = planModel([
      { kind: 'tool-call', usage: usageOf(100, 10) },
      { kind: 'error' },
      { kind: 'error' },
      { kind: 'error' },
      { kind: 'error' },
      { kind: 'error' },
    ]);

    await postMessage();

    // The failing second step was actually requested.
    expect(model.doStreamCalls.length).toBeGreaterThanOrEqual(2);
    expect(recordAiUsage).toHaveBeenCalledTimes(1);
    expect(recordAiUsage).toHaveBeenCalledWith({
      userId: 'user-1',
      feature: 'chat',
      modelKey: MODEL_KEY,
      calls: [callUsage(100, 10)],
    });
  });

  it('closes as a failure that warns with user, feature and model when the provider fails before reporting any usage', async () => {
    const model = planModel([
      { kind: 'error' },
      { kind: 'error' },
      { kind: 'error' },
      { kind: 'error' },
      { kind: 'error' },
    ]);

    await postMessage();

    expect(model.doStreamCalls.length).toBeGreaterThanOrEqual(1);
    expect(recordAiUsage).not.toHaveBeenCalled();
    expect(loggerWarn).toHaveBeenCalledTimes(1);
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        feature: 'chat',
        modelKey: MODEL_KEY,
      }),
      expect.any(String),
    );
  });
});
