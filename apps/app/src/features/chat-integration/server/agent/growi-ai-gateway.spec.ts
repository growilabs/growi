// Runs the gateway against a REAL Mastra Agent driven by a fake language model
// (no network, no API key), so the result shapes and the abort behaviour are
// the installed library's, not a hand-written imitation of them. Mastra is
// imported only here, at test time.
import type { ConversationMessage } from '@growi/chat';
import type { IUserHasId } from '@growi/core';
import { Agent } from '@mastra/core/agent';
import { RequestContext } from '@mastra/core/request-context';
import { InMemoryStore } from '@mastra/core/storage';
import { createTool } from '@mastra/core/tools';
import { Memory } from '@mastra/memory';
import { MockLanguageModelV3 } from 'ai/test';
import { mock } from 'vitest-mock-extended';
import { z } from 'zod';

import { getOrCreateThread } from '~/features/mastra/server/services/get-or-create-thread';
import type { GetPageContentToolOutput } from '~/features/mastra/server/services/mastra-modules/tools/get-page-content-tool';

import { conversationThreadIdOf } from './conversation-thread-id';
import { createGrowiAiGateway } from './growi-ai-gateway';
import type {
  GrowiAiGateway,
  GrowiAiRunOutcome,
  GrowiAiRuntime,
} from './growi-ai-gateway-types';

// --- Fake language model ----------------------------------------------------

type GenerateResult = Awaited<ReturnType<MockLanguageModelV3['doGenerate']>>;
type GenerateOptions = Parameters<MockLanguageModelV3['doGenerate']>[0];
type PlannedStep =
  | GenerateResult
  | ((options: GenerateOptions) => Promise<GenerateResult>);

const usage: GenerateResult['usage'] = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

type PlannedToolCall = {
  readonly id: string;
  readonly toolName: 'getPageContentTool' | 'fullTextSearchTool';
  readonly pageId: string;
};

const toolCallStep = (
  calls: readonly PlannedToolCall[],
  text?: string,
): GenerateResult => ({
  content: [
    ...(text != null ? [{ type: 'text' as const, text }] : []),
    ...calls.map((call) => ({
      type: 'tool-call' as const,
      toolCallId: call.id,
      toolName: call.toolName,
      input: JSON.stringify({ pageId: call.pageId }),
    })),
  ],
  finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
  usage,
  warnings: [],
});

const textStep = (text: string): GenerateResult => ({
  content: [{ type: 'text', text }],
  finishReason: { unified: 'stop', raw: 'stop' },
  usage,
  warnings: [],
});

const planModel = (plan: readonly PlannedStep[]): MockLanguageModelV3 => {
  let next = 0;
  return new MockLanguageModelV3({
    provider: 'mock',
    modelId: 'mock-model',
    doGenerate: async (options) => {
      const step = plan[next];
      next += 1;
      if (step == null) {
        throw new Error('the model was called more times than planned');
      }
      return typeof step === 'function' ? await step(options) : step;
    },
  });
};

// A provider call that stays in flight until the run's abort signal fires.
const inFlightUntilAborted = (): {
  readonly step: PlannedStep;
  readonly entered: Promise<void>;
} => {
  let markEntered: () => void = () => {};
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  const step: PlannedStep = (options) =>
    new Promise<GenerateResult>((_resolve, reject) => {
      const { abortSignal } = options;
      if (abortSignal == null) {
        reject(new Error('generate did not pass an abort signal'));
        return;
      }
      abortSignal.addEventListener('abort', () => reject(abortSignal.reason), {
        once: true,
      });
      markEntered();
    });
  return { step, entered };
};

// --- Fake tools and runtime ---------------------------------------------------

const pageToolOutput = (pageId: string): GetPageContentToolOutput =>
  pageId === 'denied'
    ? { result: 'not_found_or_forbidden', reason: 'denied' }
    : {
        result: 'ok',
        page: { pageId, path: `/wiki/${pageId}`, totalLines: 1 },
      };

const pageInputSchema = z.object({ pageId: z.string() });

const fakePageTool = createTool({
  id: 'get-page-content-tool',
  description: 'Read a page',
  inputSchema: pageInputSchema,
  execute: async ({ pageId }) => pageToolOutput(pageId),
});

// Returns the same shape as the page tool, so only the registration key tells
// the two apart.
const fakeSearchTool = createTool({
  id: 'full-text-search-tool',
  description: 'Search pages',
  inputSchema: pageInputSchema,
  execute: async ({ pageId }) => pageToolOutput(pageId),
});

const SITE_URL = 'https://wiki.example.com';

type Harness = {
  readonly gateway: GrowiAiGateway;
  readonly memory: Memory;
  readonly model: MockLanguageModelV3;
  readonly runOutcomes: string[];
};

const harness = (
  plan: readonly PlannedStep[],
  overrides: Partial<GrowiAiRuntime> = {},
): Harness => {
  const model = planModel(plan);
  const memory = new Memory({ storage: new InMemoryStore() });
  const agent = new Agent({
    id: 'growiAgent',
    name: 'GROWI Agent',
    instructions: 'test',
    model,
    tools: {
      fullTextSearchTool: fakeSearchTool,
      getPageContentTool: fakePageTool,
    },
    memory,
  });
  const runOutcomes: string[] = [];
  const runtime: GrowiAiRuntime = {
    agent,
    getOrCreateThread,
    beginRun: () => ({
      requestContext: new RequestContext(),
      providerOptions: {},
      finish: (outcome) => {
        runOutcomes.push(outcome);
      },
    }),
    ...overrides,
  };
  const gateway = createGrowiAiGateway({
    loadRuntime: async () => runtime,
    siteUrl: () => SITE_URL,
  });
  return { gateway, memory, model, runOutcomes };
};

const user = mock<IUserHasId>({ _id: '64b7f0c2a1b2c3d4e5f60718' });

const running = (): AbortController => new AbortController();

const completedValue = <T>(outcome: GrowiAiRunOutcome<T>): T => {
  if (outcome.kind !== 'completed') {
    throw new Error(`expected a completed run, got ${outcome.kind}`);
  }
  return outcome.value;
};

const pageCall = (id: string, pageId: string): PlannedToolCall => ({
  id,
  toolName: 'getPageContentTool',
  pageId,
});

// --- classify -----------------------------------------------------------------

describe('GrowiAiGateway.classify', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('classifies a question as an answer request', async () => {
    const { gateway } = harness([textStep('{"intent":"answer","path":null}')]);

    const outcome = await gateway.classify('What is our release process?', {
      user,
      signal: running().signal,
    });

    expect(completedValue(outcome)).toEqual({ intent: 'answer' });
  });

  it('classifies a summary request together with the requested page path', async () => {
    const { gateway } = harness([
      textStep('{"intent":"summarize-to-page","path":"/team/notes/release"}'),
    ]);

    const outcome = await gateway.classify(
      'Summarize this thread into /team/notes/release',
      { user, signal: running().signal },
    );

    expect(completedValue(outcome)).toEqual({
      intent: 'summarize-to-page',
      path: '/team/notes/release',
    });
  });

  it('classifies a summary request without a path as path null', async () => {
    const { gateway } = harness([
      textStep('{"intent":"summarize-to-page","path":null}'),
    ]);

    const outcome = await gateway.classify('Summarize this conversation', {
      user,
      signal: running().signal,
    });

    expect(completedValue(outcome)).toEqual({
      intent: 'summarize-to-page',
      path: null,
    });
  });

  it('rejects when the model output is not a classification', async () => {
    // Mastra prints a failed run to console.error regardless of any logger.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { gateway } = harness([textStep('{"intent":"other","path":null}')]);

    await expect(
      gateway.classify('hello', { user, signal: running().signal }),
    ).rejects.toThrow();
  });

  it('reports an abort, without calling the model, when the signal is already aborted', async () => {
    const { gateway, model } = harness([
      textStep('{"intent":"answer","path":null}'),
    ]);
    const controller = running();
    controller.abort();

    const outcome = await gateway.classify('question', {
      user,
      signal: controller.signal,
    });

    expect(outcome).toEqual({ kind: 'aborted' });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('reports an abort, not a malformed output, when aborted while the model is answering', async () => {
    const inFlight = inFlightUntilAborted();
    const { gateway } = harness([inFlight.step]);
    const controller = running();

    const pending = gateway.classify('question', {
      user,
      signal: controller.signal,
    });
    await inFlight.entered;
    controller.abort();

    expect(await pending).toEqual({ kind: 'aborted' });
  });

  it('reports an abort when loading the AI fails after the signal was aborted', async () => {
    const controller = running();
    const gateway = createGrowiAiGateway({
      loadRuntime: () => {
        controller.abort();
        return Promise.reject(new Error('AI module could not be loaded'));
      },
      siteUrl: () => SITE_URL,
    });

    expect(
      await gateway.classify('question', { user, signal: controller.signal }),
    ).toEqual({ kind: 'aborted' });
  });

  it('rejects when loading the AI fails without an abort', async () => {
    const gateway = createGrowiAiGateway({
      loadRuntime: () =>
        Promise.reject(new Error('AI module could not be loaded')),
      siteUrl: () => SITE_URL,
    });

    await expect(
      gateway.classify('question', { user, signal: running().signal }),
    ).rejects.toThrow('AI module could not be loaded');
  });
});

// --- answer -------------------------------------------------------------------

const conversation = {
  relationId: 'relation-1',
  conversationKey: 'slack:D123:1700000000.000100',
} as const;

const rememberedThreadId = conversationThreadIdOf({
  relationId: conversation.relationId,
  userId: user._id,
  conversationKey: conversation.conversationKey,
});

describe('GrowiAiGateway.answer', () => {
  it('returns the answer text and the pages the page tool opened, once each, in first-opened order', async () => {
    const { gateway } = harness([
      toolCallStep([
        { id: 's1', toolName: 'fullTextSearchTool', pageId: 'p9' },
        pageCall('c1', 'p2'),
      ]),
      toolCallStep([
        pageCall('c2', 'p1'),
        pageCall('c3', 'p2'),
        pageCall('c4', 'denied'),
      ]),
      textStep('The release process is ...'),
    ]);

    const outcome = await gateway.answer(
      { text: 'How do we release?', ...conversation },
      { user, signal: running().signal },
    );

    expect(completedValue(outcome)).toEqual({
      markdown: 'The release process is ...',
      sources: [
        { title: 'p2', url: `${SITE_URL}/p2` },
        { title: 'p1', url: `${SITE_URL}/p1` },
      ],
    });
  });

  it('returns no sources when no page was opened', async () => {
    const { gateway } = harness([textStep('Hello!')]);

    const outcome = await gateway.answer(
      { text: 'hi', ...conversation },
      { user, signal: running().signal },
    );

    expect(completedValue(outcome)).toEqual({
      markdown: 'Hello!',
      sources: [],
    });
  });

  it('remembers the conversation under the id computed from relation, user and conversation key', async () => {
    const { gateway, memory, model } = harness([
      textStep('first answer'),
      textStep('second answer'),
    ]);

    await gateway.answer(
      { text: 'first question', ...conversation },
      { user, signal: running().signal },
    );
    const second = await gateway.answer(
      { text: 'second question', ...conversation },
      { user, signal: running().signal },
    );

    const thread = await memory.getThreadById({ threadId: rememberedThreadId });
    expect(thread?.resourceId).toBe(user._id);
    expect(completedValue(second).markdown).toBe('second answer');
    expect(
      model.doGenerateCalls.at(-1)?.prompt.map((message) => message.role),
    ).toEqual(['system', 'user', 'assistant', 'user']);
  });

  it('starts a separate conversation for a different conversation key', async () => {
    const { gateway, model } = harness([
      textStep('first answer'),
      textStep('other answer'),
    ]);

    await gateway.answer(
      { text: 'first question', ...conversation },
      { user, signal: running().signal },
    );
    await gateway.answer(
      {
        text: 'unrelated question',
        relationId: conversation.relationId,
        conversationKey: 'slack:D123:1700000000.999999',
      },
      { user, signal: running().signal },
    );

    expect(
      model.doGenerateCalls.at(-1)?.prompt.map((message) => message.role),
    ).toEqual(['system', 'user']);
  });

  it('records the run as completed for usage metering', async () => {
    const { gateway, runOutcomes } = harness([textStep('answer')]);

    await gateway.answer(
      { text: 'question', ...conversation },
      { user, signal: running().signal },
    );

    expect(runOutcomes).toEqual(['completed']);
  });

  it('reports an abort, without calling the model, when the signal is already aborted', async () => {
    const { gateway, model } = harness([textStep('never')]);
    const controller = running();
    controller.abort();

    const outcome = await gateway.answer(
      { text: 'question', ...conversation },
      { user, signal: controller.signal },
    );

    expect(outcome).toEqual({ kind: 'aborted' });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('reports an abort, and drops the partial text and sources, when aborted during a later model call', async () => {
    const inFlight = inFlightUntilAborted();
    const { gateway, runOutcomes } = harness([
      toolCallStep([pageCall('c1', 'p1')], 'partial text '),
      inFlight.step,
    ]);
    const controller = running();

    const pending = gateway.answer(
      { text: 'question', ...conversation },
      { user, signal: controller.signal },
    );
    await inFlight.entered;
    controller.abort();

    expect(await pending).toEqual({ kind: 'aborted' });
    expect(runOutcomes).toEqual(['failed']);
  });

  it('reports an abort when the signal fires as the model returns the whole answer', async () => {
    const controller = running();
    const { gateway } = harness([
      () => {
        controller.abort();
        return Promise.resolve(textStep('full answer'));
      },
    ]);

    const outcome = await gateway.answer(
      { text: 'question', ...conversation },
      { user, signal: controller.signal },
    );

    expect(outcome).toEqual({ kind: 'aborted' });
  });

  it('reports an abort when a step fails after the signal was aborted', async () => {
    const controller = running();
    const { gateway } = harness([textStep('never')], {
      getOrCreateThread: () => {
        controller.abort();
        return Promise.reject(new Error('storage unavailable'));
      },
    });

    const outcome = await gateway.answer(
      { text: 'question', ...conversation },
      { user, signal: controller.signal },
    );

    expect(outcome).toEqual({ kind: 'aborted' });
  });

  it('rejects when a step fails without an abort', async () => {
    const { gateway, runOutcomes } = harness([textStep('never')], {
      getOrCreateThread: () => Promise.reject(new Error('storage unavailable')),
    });

    await expect(
      gateway.answer(
        { text: 'question', ...conversation },
        { user, signal: running().signal },
      ),
    ).rejects.toThrow('storage unavailable');
    expect(runOutcomes).toEqual(['failed']);
  });
});

// --- summarize ----------------------------------------------------------------

const messages: ReadonlyArray<ConversationMessage> = [
  {
    postedAt: '2026-11-16T01:00:00.000Z',
    author: { platform: 'slack', accountId: 'U1', displayName: 'Alice' },
    markdown: 'Shall we ship on Friday?',
  },
  {
    postedAt: '2026-11-16T01:05:00.000Z',
    author: { platform: 'slack', accountId: 'U2', displayName: 'Bob' },
    markdown: 'Yes, after the QA sign-off.',
  },
];

const promptTextOf = (model: MockLanguageModelV3): string =>
  JSON.stringify(model.doGenerateCalls[0]?.prompt ?? []);

describe('GrowiAiGateway.summarize', () => {
  it('returns the title and body the model wrote for the conversation', async () => {
    const { gateway, model } = harness([
      textStep(
        JSON.stringify({
          title: 'Release on Friday',
          body: '- Ship on Friday after QA sign-off',
        }),
      ),
    ]);

    const outcome = await gateway.summarize(
      messages,
      'Summarize this conversation',
      { user, signal: running().signal },
    );

    expect(completedValue(outcome)).toEqual({
      title: 'Release on Friday',
      body: '- Ship on Friday after QA sign-off',
    });
    const prompt = promptTextOf(model);
    expect(prompt).toContain('Shall we ship on Friday?');
    expect(prompt).toContain('Bob');
    expect(prompt).toContain('Summarize this conversation');
  });

  it('rejects when the model returns an empty title', async () => {
    const { gateway } = harness([
      textStep(JSON.stringify({ title: '  ', body: 'text' })),
    ]);

    await expect(
      gateway.summarize(messages, 'Summarize', {
        user,
        signal: running().signal,
      }),
    ).rejects.toThrow();
  });

  it('reports an abort, without calling the model, when the signal is already aborted', async () => {
    const { gateway, model } = harness([textStep('never')]);
    const controller = running();
    controller.abort();

    const outcome = await gateway.summarize(messages, 'Summarize', {
      user,
      signal: controller.signal,
    });

    expect(outcome).toEqual({ kind: 'aborted' });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('reports an abort, not a malformed output, when aborted while the model is writing', async () => {
    const inFlight = inFlightUntilAborted();
    const { gateway } = harness([inFlight.step]);
    const controller = running();

    const pending = gateway.summarize(messages, 'Summarize', {
      user,
      signal: controller.signal,
    });
    await inFlight.entered;
    controller.abort();

    expect(await pending).toEqual({ kind: 'aborted' });
  });
});
