import type { IUserHasId } from '@growi/core';
import { Agent } from '@mastra/core/agent';
import { RequestContext } from '@mastra/core/request-context';
import { createTool } from '@mastra/core/tools';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { mock } from 'vitest-mock-extended';
import { z } from 'zod';

import type { AiUsageFeature, UsageMeter } from '~/features/ai-usage/server';

import type { MastraRequestContextShape } from '../mastra-modules/types/request-context';
import type { LanguageModelV3Usage } from './from-language-model-usage';

const { recordAiUsage, loggerError } = vi.hoisted(() => ({
  recordAiUsage: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('~/features/ai-usage/server', () => ({ recordAiUsage }));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    error: loggerError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  meterModelForRequest,
  meterModelPerCall,
} from './meter-model-for-request';

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

const promptText = (options: CallOptions): string =>
  JSON.stringify(options.prompt);

const hasToolResult = (options: CallOptions): boolean =>
  options.prompt.some((message) => message.role === 'tool');

// The first step of each request calls the tool, the second answers in text.
// Usage is derived from the request's own prompt so that a request's usage
// can be told apart from another request's usage under concurrency.
const usageFor = (options: CallOptions): LanguageModelV3Usage => {
  const base = promptText(options).includes('from-alice') ? 1000 : 2000;
  return hasToolResult(options) ? usageOf(base + 1, 20) : usageOf(base, 10);
};

const toStreamParts = (options: CallOptions): StreamPart[] => {
  const usage = usageFor(options);
  if (!hasToolResult(options)) {
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
        usage,
      },
    ];
  }
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: 'done' },
    { type: 'text-end', id: 't' },
    {
      type: 'finish',
      finishReason: { unified: 'stop', raw: 'stop' },
      usage,
    },
  ];
};

// One shared model instance, like the cached model shared by every request.
const createSharedModel = (): MockLanguageModelV3 =>
  new MockLanguageModelV3({
    provider: 'mock',
    modelId: 'mock-model',
    doStream: async (options) => ({
      stream: simulateReadableStream({
        chunks: toStreamParts(options),
        // Keep the two concurrent requests interleaved.
        chunkDelayInMs: 5,
      }),
    }),
  });

const echoTool = createTool({
  id: 'echo',
  description: 'Echo the input',
  inputSchema: z.object({ x: z.number() }),
  execute: async () => ({ ok: true }),
});

const createAgent = (
  model: MockLanguageModelV3,
  meter: typeof meterModelForRequest = meterModelForRequest,
  feature: AiUsageFeature = 'chat',
) =>
  new Agent({
    id: 'metered-agent',
    name: 'metered-agent',
    instructions: 'You are a test agent.',
    model: ({
      requestContext,
    }: {
      requestContext: RequestContext<MastraRequestContextShape>;
    }) => meter(requestContext, feature, model),
    tools: { echo: echoTool },
  });

const createContext = (params: {
  readonly user?: IUserHasId;
  readonly modelKey?: string;
  readonly usageMeter?: UsageMeter;
}): RequestContext<MastraRequestContextShape> => {
  const requestContext = new RequestContext<MastraRequestContextShape>();
  if (params.user != null) {
    requestContext.set('user', params.user);
  }
  if (params.modelKey != null) {
    requestContext.set('modelKey', params.modelKey);
  }
  if (params.usageMeter != null) {
    requestContext.set('usageMeter', params.usageMeter);
  }
  return requestContext;
};

const userWithId = (id: string): IUserHasId => mock<IUserHasId>({ _id: id });

const runRequest = async (
  agent: ReturnType<typeof createAgent>,
  message: string,
  requestContext: RequestContext<MastraRequestContextShape>,
): Promise<string> => {
  const output = await agent.stream(message, { requestContext, maxSteps: 5 });
  for await (const _chunk of output.fullStream) {
    // drain the stream to its end
  }
  return await output.text;
};

const addedUsage = (meter: UsageMeter) =>
  vi.mocked(meter.add).mock.calls.map(([usage]) => usage.inputTokens);

describe('meterModelForRequest', () => {
  beforeEach(() => {
    recordAiUsage.mockReset();
    recordAiUsage.mockResolvedValue(undefined);
    loggerError.mockReset();
  });

  describe('when the request context holds a usage meter', () => {
    it('hands each call usage only to its own request meter under concurrency', async () => {
      const agent = createAgent(createSharedModel());
      const aliceMeter = mock<UsageMeter>();
      const bobMeter = mock<UsageMeter>();

      const [aliceText, bobText] = await Promise.all([
        runRequest(
          agent,
          'from-alice',
          createContext({
            user: userWithId('alice'),
            modelKey: 'openai/gpt-4o',
            usageMeter: aliceMeter,
          }),
        ),
        runRequest(
          agent,
          'from-bob',
          createContext({
            user: userWithId('bob'),
            modelKey: 'openai/gpt-4o',
            usageMeter: bobMeter,
          }),
        ),
      ]);

      expect(aliceText).toBe('done');
      expect(bobText).toBe('done');
      expect(addedUsage(aliceMeter)).toEqual([1000, 1001]);
      expect(addedUsage(bobMeter)).toEqual([2000, 2001]);
      expect(recordAiUsage).not.toHaveBeenCalled();
    });

    it('still answers when the user is absent from the context', async () => {
      const agent = createAgent(createSharedModel());
      const meter = mock<UsageMeter>();

      const text = await runRequest(
        agent,
        'from-alice',
        createContext({ modelKey: 'openai/gpt-4o', usageMeter: meter }),
      );

      expect(text).toBe('done');
      expect(addedUsage(meter)).toEqual([1000, 1001]);
    });
  });

  describe('when the request context holds no usage meter', () => {
    it('records one single-call entry per call for the context user and model', async () => {
      const agent = createAgent(createSharedModel());

      const text = await runRequest(
        agent,
        'from-alice',
        createContext({
          user: userWithId('alice'),
          modelKey: 'openai/gpt-4o',
        }),
      );

      expect(text).toBe('done');
      expect(recordAiUsage.mock.calls).toEqual([
        [
          {
            userId: 'alice',
            feature: 'chat',
            modelKey: 'openai/gpt-4o',
            calls: [expect.objectContaining({ inputTokens: 1000 })],
          },
        ],
        [
          {
            userId: 'alice',
            feature: 'chat',
            modelKey: 'openai/gpt-4o',
            calls: [expect.objectContaining({ inputTokens: 1001 })],
          },
        ],
      ]);
    });

    it('reads the user at record time, not when the model is wrapped', async () => {
      const requestContext = createContext({ modelKey: 'openai/gpt-4o' });
      const metered = meterModelForRequest(
        requestContext,
        'chat',
        createSharedModel(),
      );
      requestContext.set('user', userWithId('late-user'));
      const agent = new Agent({
        id: 'pre-wrapped-agent',
        name: 'pre-wrapped-agent',
        instructions: 'You are a test agent.',
        model: metered,
      });

      const output = await agent.stream('from-alice', { requestContext });
      await output.text;

      expect(recordAiUsage).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'late-user' }),
      );
    });

    it('still answers and only logs an error when the user is absent', async () => {
      const agent = createAgent(createSharedModel());

      const text = await runRequest(
        agent,
        'from-alice',
        createContext({ modelKey: 'openai/gpt-4o' }),
      );

      expect(text).toBe('done');
      expect(recordAiUsage).not.toHaveBeenCalled();
      expect(loggerError).toHaveBeenCalled();
    });

    it('still answers and only logs an error when the model key is absent', async () => {
      const agent = createAgent(createSharedModel());

      const text = await runRequest(
        agent,
        'from-alice',
        createContext({ user: userWithId('alice') }),
      );

      expect(text).toBe('done');
      expect(recordAiUsage).not.toHaveBeenCalled();
      expect(loggerError).toHaveBeenCalled();
    });
  });

  it('leaves the given model unwrapped so a cached instance stays reusable', async () => {
    const model = createSharedModel();
    const meter = mock<UsageMeter>();
    meterModelForRequest(createContext({ usageMeter: meter }), 'chat', model);

    const { stream } = await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    });
    await stream.pipeTo(new WritableStream());

    expect(meter.add).not.toHaveBeenCalled();
  });
});

describe('meterModelPerCall', () => {
  beforeEach(() => {
    recordAiUsage.mockReset();
    recordAiUsage.mockResolvedValue(undefined);
  });

  it('records each call on its own and leaves the request usage meter untouched', async () => {
    const meter = mock<UsageMeter>();
    const requestContext = createContext({
      user: userWithId('alice'),
      modelKey: 'openai/gpt-4o',
      usageMeter: meter,
    });
    const agent = createAgent(
      createSharedModel(),
      meterModelPerCall,
      'thread-title',
    );

    const text = await runRequest(agent, 'from-alice', requestContext);

    expect(text).toBe('done');
    expect(meter.add).not.toHaveBeenCalled();
    expect(recordAiUsage.mock.calls).toEqual([
      [
        {
          userId: 'alice',
          feature: 'thread-title',
          modelKey: 'openai/gpt-4o',
          calls: [expect.objectContaining({ inputTokens: 1000 })],
        },
      ],
      [
        {
          userId: 'alice',
          feature: 'thread-title',
          modelKey: 'openai/gpt-4o',
          calls: [expect.objectContaining({ inputTokens: 1001 })],
        },
      ],
    ]);
  });
});
