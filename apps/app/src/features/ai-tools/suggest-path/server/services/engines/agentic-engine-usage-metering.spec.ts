// Drives the real agentic engine with the real suggestPathAgent, Mastra Agent
// and usage meter, replacing only the LLM (MockLanguageModelV3), the agent's
// tools, the model/key resolvers, the grant lookup and the usage write
// (recordAiUsage).
import type { IUserHasId } from '@growi/core/dist/interfaces';
import type { MastraModelConfig } from '@mastra/core/llm';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { mock } from 'vitest-mock-extended';

import type { AiUsageEntry } from '~/features/ai-usage/server';
import { buildModelKey } from '~/features/mastra/interfaces/model-key';
import type { LanguageModelV3Usage } from '~/features/mastra/server/services/usage-metering/from-language-model-usage';

import type { SearchService } from '../../../interfaces/suggest-path-types';

const MODEL_KEY = buildModelKey('openai', 'test-model');

const {
  recordAiUsage,
  resolveMastraModel,
  getEffectiveDefaultModelKey,
  getProviderOptionsForModel,
  modelHolder,
  configValues,
} = vi.hoisted(() => ({
  recordAiUsage: vi.fn<(entry: AiUsageEntry) => Promise<void>>(),
  resolveMastraModel: vi.fn<(modelKey?: string) => Promise<unknown>>(),
  getEffectiveDefaultModelKey: vi.fn<() => string>(),
  getProviderOptionsForModel: vi.fn<(modelKey: string) => object>(),
  modelHolder: { current: undefined as MastraModelConfig | undefined },
  configValues: new Map<string, unknown>(),
}));

vi.mock('~/features/ai-usage/server/services/record-ai-usage', () => ({
  recordAiUsage,
}));
// The barrel also pulls in the public route and Prisma models; only the meter
// and the recorder are reached from the suggest-path path.
vi.mock('~/features/ai-usage/server', async () => {
  const { createUsageMeter } = await import(
    '~/features/ai-usage/server/services/usage-meter'
  );
  return { createUsageMeter, recordAiUsage };
});

vi.mock(
  '~/features/mastra/server/services/ai-sdk-modules/llm-providers/effective-model-key',
  () => ({
    getEffectiveDefaultModelKey,
    resolveEffectiveModelKey: () => MODEL_KEY,
  }),
);
vi.mock(
  '~/features/mastra/server/services/ai-sdk-modules/resolve-provider-options',
  () => ({ getProviderOptionsForModel }),
);
vi.mock(
  '~/features/mastra/server/services/ai-sdk-modules/resolve-mastra-model',
  () => ({ resolveMastraModel }),
);

vi.mock(
  '~/features/mastra/server/services/mastra-modules/agents/suggest-path/limited-search-tool',
  async () => {
    const { createTool } = await import('@mastra/core/tools');
    const { z } = await import('zod');
    return {
      limitedSearchTool: createTool({
        id: 'limited-search-tool',
        description: 'Search pages',
        inputSchema: z.object({ query: z.string() }),
        execute: async () => ({ pages: [] }),
      }),
    };
  },
);
vi.mock(
  '~/features/mastra/server/services/mastra-modules/agents/suggest-path/list-children-tool',
  async () => {
    const { createTool } = await import('@mastra/core/tools');
    const { z } = await import('zod');
    return {
      listChildrenTool: createTool({
        id: 'list-children-tool',
        description: 'List child pages',
        inputSchema: z.object({ path: z.string() }),
        execute: async () => ({ children: [] }),
      }),
    };
  },
);
vi.mock(
  '~/features/mastra/server/services/mastra-modules/tools/get-page-content-tool',
  async () => {
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
  },
);
vi.mock('~/features/mastra/server/services/mastra-modules', async () => {
  const { suggestPathAgent } = await import(
    '~/features/mastra/server/services/mastra-modules/agents/suggest-path/suggest-path-agent'
  );
  return { mastra: { getAgent: () => suggestPathAgent } };
});

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig: (key: string) => configValues.get(key) },
}));
vi.mock('../resolve-parent-grant', () => ({
  resolveParentGrant: async () => 1,
}));
vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { agenticEngine } from './agentic-engine';

type StreamPart =
  Awaited<
    ReturnType<MockLanguageModelV3['doStream']>
  >['stream'] extends ReadableStream<infer T>
    ? T
    : never;
type GenerateResult = Awaited<ReturnType<MockLanguageModelV3['doGenerate']>>;

type Step =
  | { kind: 'tool-call'; usage: LanguageModelV3Usage }
  | { kind: 'output'; usage: LanguageModelV3Usage }
  | { kind: 'hang-until-aborted' };

const OUTPUT_JSON = JSON.stringify({
  informationType: 'stock',
  suggestions: [{ path: '/tech/', label: 'Tech', description: 'Tech notes' }],
});

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

const toStreamParts = (
  step: Exclude<Step, { kind: 'hang-until-aborted' }>,
): StreamPart[] => {
  if (step.kind === 'tool-call') {
    return [
      { type: 'stream-start', warnings: [] },
      {
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'fullTextSearch',
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
    { type: 'text-delta', id: 't', delta: OUTPUT_JSON },
    { type: 'text-end', id: 't' },
    {
      type: 'finish',
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: step.usage,
    },
  ];
};

const toGenerateResult = (
  step: Exclude<Step, { kind: 'hang-until-aborted' }>,
): GenerateResult => {
  if (step.kind === 'tool-call') {
    return {
      content: [
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'fullTextSearch',
          input: JSON.stringify({ query: 'growi' }),
        },
      ],
      finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
      usage: step.usage,
      warnings: [],
    };
  }
  return {
    content: [{ type: 'text', text: OUTPUT_JSON }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: step.usage,
    warnings: [],
  };
};

const waitForAbort = (signal: AbortSignal | undefined): Promise<never> =>
  new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason));
  });

// Each model call (whichever method Mastra uses) answers the next planned step.
const planModel = (plan: readonly Step[]): MockLanguageModelV3 => {
  let next = 0;
  const takeStep = (): Step => {
    const step = plan[next];
    next += 1;
    if (step == null) {
      throw new Error('the model was called more times than planned');
    }
    return step;
  };
  const model = new MockLanguageModelV3({
    provider: 'mock',
    modelId: 'mock-model',
    doGenerate: async ({ abortSignal }) => {
      const step = takeStep();
      if (step.kind === 'hang-until-aborted') {
        return waitForAbort(abortSignal);
      }
      return toGenerateResult(step);
    },
    doStream: async ({ abortSignal }) => {
      const step = takeStep();
      if (step.kind === 'hang-until-aborted') {
        return waitForAbort(abortSignal);
      }
      return {
        stream: simulateReadableStream({ chunks: toStreamParts(step) }),
      };
    },
  });
  modelHolder.current = model;
  return model;
};

const modelCallCount = (model: MockLanguageModelV3): number =>
  model.doStreamCalls.length + model.doGenerateCalls.length;

const proposePaths = () => {
  const user = mock<IUserHasId>();
  user._id = mock<IUserHasId['_id']>();
  user._id.toString = () => 'user-1';
  return agenticEngine({
    user,
    body: 'Some document content',
    userGroups: [],
    searchService: mock<SearchService>(),
  });
};

describe('agentic engine usage metering (Req 2.2, 2.6)', () => {
  beforeEach(() => {
    recordAiUsage.mockReset();
    recordAiUsage.mockResolvedValue(undefined);
    resolveMastraModel.mockReset();
    resolveMastraModel.mockImplementation(async () => {
      if (modelHolder.current == null) {
        throw new Error('no model planned for this test');
      }
      return modelHolder.current;
    });
    modelHolder.current = undefined;
    getEffectiveDefaultModelKey.mockReset();
    getEffectiveDefaultModelKey.mockReturnValue(MODEL_KEY);
    getProviderOptionsForModel.mockReset();
    getProviderOptionsForModel.mockReturnValue({});
    configValues.clear();
    configValues.set('aiTools:suggestPathAgenticSearchLimit', 5);
    configValues.set('aiTools:suggestPathAgenticChildListingLimit', 5);
    configValues.set('aiTools:suggestPathAgenticTimeoutMs', 60_000);
    configValues.set('ai:providerOptions:suggestPathAgent', null);
  });

  it('records one proposal with a tool call in between as exactly one record with the calls of every step', async () => {
    const model = planModel([
      { kind: 'tool-call', usage: usageOf(100, 10) },
      { kind: 'output', usage: usageOf(200, 20) },
    ]);

    const suggestions = await proposePaths();

    expect(suggestions.map((s) => s.path)).toEqual(['/tech/']);
    expect(recordAiUsage).toHaveBeenCalledTimes(1);
    expect(recordAiUsage).toHaveBeenCalledWith({
      userId: 'user-1',
      feature: 'suggest-path',
      modelKey: MODEL_KEY,
      calls: [callUsage(100, 10), callUsage(200, 20)],
    });
    // Structured output with only a schema is produced by the agent's own
    // model, so every model call is in the record and no other call happens.
    expect(modelCallCount(model)).toBe(2);
  });

  it('builds the model from the same key it records', async () => {
    planModel([{ kind: 'output', usage: usageOf(200, 20) }]);

    await proposePaths();

    expect(resolveMastraModel).toHaveBeenCalled();
    for (const [modelKey] of resolveMastraModel.mock.calls) {
      expect(modelKey).toBe(MODEL_KEY);
    }
    expect(recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ modelKey: MODEL_KEY }),
    );
  });

  it('decides the default model key once and uses it for the model, the provider options and the record', async () => {
    const keyA = buildModelKey('openai', 'model-a');
    const keyB = buildModelKey('openai', 'model-b');
    getEffectiveDefaultModelKey.mockReset();
    getEffectiveDefaultModelKey.mockReturnValueOnce(keyA);
    getEffectiveDefaultModelKey.mockReturnValue(keyB);
    planModel([{ kind: 'output', usage: usageOf(200, 20) }]);

    await proposePaths();

    expect(getEffectiveDefaultModelKey).toHaveBeenCalledTimes(1);
    expect(resolveMastraModel).toHaveBeenCalled();
    for (const [modelKey] of resolveMastraModel.mock.calls) {
      expect(modelKey).toBe(keyA);
    }
    expect(getProviderOptionsForModel).toHaveBeenCalledTimes(1);
    expect(getProviderOptionsForModel).toHaveBeenCalledWith(keyA);
    expect(recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ modelKey: keyA }),
    );
  });

  it('asks the model for the structured output as JSON', async () => {
    const model = planModel([{ kind: 'output', usage: usageOf(200, 20) }]);

    await proposePaths();

    const [call] = [...model.doStreamCalls, ...model.doGenerateCalls];
    expect(call?.responseFormat).toEqual(
      expect.objectContaining({ type: 'json' }),
    );
  });

  it('still records the calls collected before the proposal timed out', async () => {
    configValues.set('aiTools:suggestPathAgenticTimeoutMs', 1500);
    const model = planModel([
      { kind: 'tool-call', usage: usageOf(100, 10) },
      { kind: 'hang-until-aborted' },
    ]);

    // Mastra settles an aborted generate without output, so the engine
    // rejects on the missing structured output.
    await expect(proposePaths()).rejects.toThrow(
      'agentic engine returned an output that failed structured-output validation',
    );

    // The hanging second step was actually requested.
    expect(modelCallCount(model)).toBe(2);
    expect(recordAiUsage).toHaveBeenCalledTimes(1);
    expect(recordAiUsage).toHaveBeenCalledWith({
      userId: 'user-1',
      feature: 'suggest-path',
      modelKey: MODEL_KEY,
      calls: [callUsage(100, 10)],
    });
  });
});
