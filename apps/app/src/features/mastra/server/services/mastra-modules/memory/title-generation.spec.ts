// Runs the real Mastra Agent and Memory (in-memory storage) with the shipped
// title generation config, replacing only the LLM (MockLanguageModelV3), the
// model resolver and the usage write (recordAiUsage).
import type { IUserHasId } from '@growi/core';
import { Agent } from '@mastra/core/agent';
import type { MastraModelConfig } from '@mastra/core/llm';
import { RequestContext } from '@mastra/core/request-context';
import { InMemoryStore } from '@mastra/core/storage';
import { createTool } from '@mastra/core/tools';
import { Memory } from '@mastra/memory';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { mock } from 'vitest-mock-extended';
import { z } from 'zod';

import type { AiUsageEntry } from '~/features/ai-usage/server';
import { buildModelKey } from '~/features/mastra/interfaces/model-key';

import type { LanguageModelV3Usage } from '../../usage-metering/from-language-model-usage';
import type { MastraRequestContextShape } from '../types/request-context';

const MODEL_KEY = buildModelKey('openai', 'gpt-4o');
const TITLE = 'Generated title';

const { recordAiUsage, loggerError, resolveMastraModel } = vi.hoisted(() => ({
  recordAiUsage: vi.fn<(entry: AiUsageEntry) => Promise<void>>(),
  loggerError: vi.fn(),
  resolveMastraModel: vi.fn<(modelKey?: string) => MastraModelConfig>(),
}));

vi.mock('~/features/ai-usage/server/services/record-ai-usage', () => ({
  recordAiUsage,
}));
// The barrel also pulls in the public route and Prisma models.
vi.mock('~/features/ai-usage/server', async () => {
  const { createUsageMeter } = await import(
    '~/features/ai-usage/server/services/usage-meter'
  );
  return { createUsageMeter, recordAiUsage };
});
vi.mock('../../ai-sdk-modules/resolve-mastra-model', () => ({
  resolveMastraModel: async (modelKey?: string) => resolveMastraModel(modelKey),
}));
vi.mock('~/utils/logger', () => ({
  default: () => ({
    error: loggerError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { createUsageMeter } from '~/features/ai-usage/server';

import { meterModelForRequest } from '../../usage-metering';
import { titleGeneration } from './title-generation';

type StreamPart =
  Awaited<
    ReturnType<MockLanguageModelV3['doStream']>
  >['stream'] extends ReadableStream<infer T>
    ? T
    : never;
type CallOptions = Parameters<MockLanguageModelV3['doStream']>[0];

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

const textParts = (text: string, usage: LanguageModelV3Usage): StreamPart[] => [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: text },
  { type: 'text-end', id: 't' },
  { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
];

const toStreamParts = (options: CallOptions): StreamPart[] => {
  if (!options.prompt.some((message) => message.role === 'tool')) {
    return [
      { type: 'stream-start', warnings: [] },
      {
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'echo',
        input: JSON.stringify({ x: 1 }),
      },
      {
        type: 'finish',
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: usageOf(100, 10),
      },
    ];
  }
  return textParts('done', usageOf(200, 20));
};

const createModel = (): MockLanguageModelV3 =>
  new MockLanguageModelV3({
    provider: 'mock',
    modelId: 'mock-model',
    doStream: async (options) => ({
      stream: simulateReadableStream({ chunks: toStreamParts(options) }),
    }),
    // The chat streams; Mastra generates the title with a non-streaming call.
    doGenerate: () =>
      Promise.resolve({
        content: [{ type: 'text', text: TITLE }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: usageOf(7, 3),
        warnings: [],
      }),
  });

const echoTool = createTool({
  id: 'echo',
  description: 'Echo the input',
  inputSchema: z.object({ x: z.number() }),
  execute: async () => ({ ok: true }),
});

const createAgent = (model: MockLanguageModelV3) => {
  const memory = new Memory({
    storage: new InMemoryStore(),
    options: { generateTitle: titleGeneration },
  });
  const agent = new Agent({
    id: 'title-agent',
    name: 'title-agent',
    instructions: 'You are a test agent.',
    // The chat side as growi-agent wires it.
    model: ({
      requestContext,
    }: {
      requestContext: RequestContext<MastraRequestContextShape>;
    }) => meterModelForRequest(requestContext, 'chat', model),
    tools: { echo: echoTool },
    memory,
  });
  return { agent, memory };
};

const userWithId = (id: string): IUserHasId => mock<IUserHasId>({ _id: id });

const createContext = (params: {
  readonly user?: IUserHasId;
}): RequestContext<MastraRequestContextShape> => {
  const requestContext = new RequestContext<MastraRequestContextShape>();
  if (params.user != null) {
    requestContext.set('user', params.user);
  }
  requestContext.set('modelKey', MODEL_KEY);
  return requestContext;
};

const runChat = async (
  agent: ReturnType<typeof createAgent>['agent'],
  requestContext: RequestContext<MastraRequestContextShape>,
  threadId: string,
): Promise<void> => {
  const output = await agent.stream('Find pages about GROWI', {
    requestContext,
    maxSteps: 5,
    memory: { thread: threadId, resource: 'user-1' },
  });
  for await (const _chunk of output.fullStream) {
    // drain the stream to its end
  }
};

const recordsOf = (feature: AiUsageEntry['feature']): AiUsageEntry[] =>
  recordAiUsage.mock.calls
    .map(([entry]) => entry)
    .filter((entry) => entry.feature === feature);

const waitForTitle = async (
  memory: Memory,
  threadId: string,
): Promise<void> => {
  await vi.waitFor(async () => {
    expect((await memory.getThreadById({ threadId }))?.title).toBe(TITLE);
  });
};

describe('thread title generation usage (Req 2.3, 2.8)', () => {
  beforeEach(() => {
    recordAiUsage.mockReset();
    recordAiUsage.mockResolvedValue(undefined);
    loggerError.mockReset();
    resolveMastraModel.mockReset();
  });

  it('records one title generation as a single thread-title record, apart from the chat meter', async () => {
    const model = createModel();
    resolveMastraModel.mockReturnValue(model);
    const { agent, memory } = createAgent(model);
    const requestContext = createContext({ user: userWithId('user-1') });
    const meter = createUsageMeter({
      userId: 'user-1',
      feature: 'chat',
      modelKey: MODEL_KEY,
    });
    requestContext.set('usageMeter', meter);

    await runChat(agent, requestContext, 'thread-1');
    meter.close({ outcome: 'completed' });
    await vi.waitFor(() => {
      expect(recordsOf('thread-title')).toHaveLength(1);
    });
    await waitForTitle(memory, 'thread-1');

    expect(resolveMastraModel).toHaveBeenCalledWith(MODEL_KEY);
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

  it('still generates the title and only logs an error when the request has no user', async () => {
    const model = createModel();
    resolveMastraModel.mockReturnValue(model);
    const { agent, memory } = createAgent(model);

    await runChat(agent, createContext({}), 'thread-2');
    await waitForTitle(memory, 'thread-2');
    await vi.waitFor(() => {
      expect(loggerError).toHaveBeenCalledWith(
        expect.objectContaining({ feature: 'thread-title' }),
        expect.any(String),
      );
    });

    expect(recordsOf('thread-title')).toEqual([]);
  });
});
