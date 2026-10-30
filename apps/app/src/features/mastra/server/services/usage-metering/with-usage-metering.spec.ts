import { Agent } from '@mastra/core/agent';
import { InMemoryStore } from '@mastra/core/storage';
import { createTool } from '@mastra/core/tools';
import { Memory } from '@mastra/memory';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { z } from 'zod';

import type { TokenUsage } from '~/features/ai-usage/server/services/token-usage';

import type { LanguageModelV3Usage } from './from-language-model-usage';

const { loggerError, loggerWarn } = vi.hoisted(() => ({
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    error: loggerError,
    warn: loggerWarn,
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { withUsageMetering } from './with-usage-metering';

type GenerateResult = Awaited<ReturnType<MockLanguageModelV3['doGenerate']>>;
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

const usageOf = (
  input: number,
  output: number,
  cacheRead?: number,
): LanguageModelV3Usage => ({
  inputTokens: {
    total: input,
    noCache: input - (cacheRead ?? 0),
    cacheRead,
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
        toolName: 'echo',
        input: JSON.stringify({ x: 1 }),
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

const toGenerateResult = (step: Step): GenerateResult => {
  if (step.kind === 'error') {
    throw new Error('provider failed');
  }
  if (step.kind === 'tool-call') {
    return {
      content: [
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'echo',
          input: JSON.stringify({ x: 1 }),
        },
      ],
      finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
      usage: step.usage,
      warnings: [],
    };
  }
  return {
    content: [{ type: 'text', text: step.text }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: step.usage,
    warnings: [],
  };
};

// Each doGenerate/doStream call consumes the next planned step, as a provider
// would answer one agent step.
const createPlannedModel = (plan: readonly Step[]): MockLanguageModelV3 => {
  let next = 0;
  const takeStep = (): Step => {
    const step = plan[next];
    next += 1;
    if (step == null) {
      throw new Error('the model was called more times than planned');
    }
    return step;
  };
  return new MockLanguageModelV3({
    provider: 'mock',
    modelId: 'mock-model',
    doGenerate: async () => toGenerateResult(takeStep()),
    doStream: async () => ({
      stream: simulateReadableStream({ chunks: toStreamParts(takeStep()) }),
    }),
  });
};

const echoTool = createTool({
  id: 'echo',
  description: 'Echo the input',
  inputSchema: z.object({ x: z.number() }),
  execute: async () => ({ ok: true }),
});

type Mode = 'stream' | 'generate';

const runAgent = async (
  mode: Mode,
  model: MockLanguageModelV3,
  onCall: (usage: TokenUsage) => void | PromiseLike<void>,
): Promise<string> => {
  const agent = new Agent({
    id: 'metered-agent',
    name: 'metered-agent',
    instructions: 'You are a test agent.',
    model: () => withUsageMetering(model, onCall),
    tools: { echo: echoTool },
    memory: new Memory({ storage: new InMemoryStore() }),
  });
  const options = {
    maxSteps: 5,
    memory: { thread: 'thread-1', resource: 'user-1' },
  };
  if (mode === 'stream') {
    const output = await agent.stream('hello', options);
    for await (const _chunk of output.fullStream) {
      // drain the stream to its end
    }
    return await output.text;
  }
  const output = await agent.generate('hello', options);
  return output.text;
};

const MODES: readonly Mode[] = ['stream', 'generate'];

describe('withUsageMetering', () => {
  describe.each(MODES)('with agent.%s', (mode) => {
    it('passes the usage of a single call', async () => {
      const onCall = vi.fn();
      const model = createPlannedModel([
        { kind: 'text', text: 'done', usage: usageOf(120, 30, 40) },
      ]);

      const text = await runAgent(mode, model, onCall);

      expect(text).toBe('done');
      expect(onCall.mock.calls).toEqual([
        [
          {
            inputTokens: 120,
            outputTokens: 30,
            reasoningTokens: null,
            cacheReadTokens: 40,
            cacheWriteTokens: null,
          },
        ],
      ]);
    });

    it('passes the usage of each step separately', async () => {
      const onCall = vi.fn();
      const model = createPlannedModel([
        { kind: 'tool-call', usage: usageOf(100, 10) },
        { kind: 'text', text: 'done', usage: usageOf(200, 20) },
      ]);

      await runAgent(mode, model, onCall);

      expect(onCall.mock.calls.map(([usage]) => usage)).toEqual([
        expect.objectContaining({ inputTokens: 100, outputTokens: 10 }),
        expect.objectContaining({ inputTokens: 200, outputTokens: 20 }),
      ]);
    });

    it('still passes the first step usage when the second step fails', async () => {
      const onCall = vi.fn();
      const model = createPlannedModel([
        { kind: 'tool-call', usage: usageOf(100, 10) },
        { kind: 'error' },
      ]);

      await runAgent(mode, model, onCall).catch(() => undefined);

      // The failing second step was actually requested (Mastra may retry it).
      expect(
        model.doStreamCalls.length + model.doGenerateCalls.length,
      ).toBeGreaterThanOrEqual(2);

      expect(onCall.mock.calls.map(([usage]) => usage)).toEqual([
        expect.objectContaining({ inputTokens: 100, outputTokens: 10 }),
      ]);
    });

    it('returns the response unchanged and logs an error when onCall throws', async () => {
      const model = createPlannedModel([
        { kind: 'text', text: 'done', usage: usageOf(120, 30) },
      ]);

      const text = await runAgent(mode, model, () => {
        throw new Error('recording failed');
      });

      expect(text).toBe('done');
      expect(loggerError).toHaveBeenCalled();
    });

    it('returns the response unchanged and logs an error when onCall rejects', async () => {
      const model = createPlannedModel([
        { kind: 'text', text: 'done', usage: usageOf(120, 30) },
      ]);

      const text = await runAgent(mode, model, () =>
        Promise.reject(new Error('recording failed')),
      );
      // Let the rejection settle before checking the log.
      await new Promise((resolve) => setImmediate(resolve));

      expect(text).toBe('done');
      expect(loggerError).toHaveBeenCalled();
    });

    it('does not hold the response back while onCall is still pending', async () => {
      const model = createPlannedModel([
        { kind: 'text', text: 'done', usage: usageOf(120, 30) },
      ]);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<string>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('the response was held back by onCall')),
          5000,
        );
      });

      try {
        const text = await Promise.race([
          runAgent(mode, model, () => new Promise<void>(() => {})),
          timeout,
        ]);
        expect(text).toBe('done');
      } finally {
        clearTimeout(timer);
      }
    });
  });

  describe('a model it cannot wrap', () => {
    it.each([
      ['a model router id', 'openai/gpt-4o'],
      ['an OpenAI-compatible config', { id: 'custom/model' as const }],
    ])('returns %s as-is and logs a warning', (_label, model) => {
      const onCall = vi.fn();

      expect(withUsageMetering(model, onCall)).toBe(model);
      expect(loggerWarn).toHaveBeenCalled();
    });
  });
});
