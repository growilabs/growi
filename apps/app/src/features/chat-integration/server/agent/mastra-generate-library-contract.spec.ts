// Pins behaviour of the INSTALLED Mastra (`agent.generate`) that the chat
// integration's AI entry relies on (research.md "インストール済みの Mastra の
// generate の結果と打ち切り"). Mastra is imported only here, at test time;
// production modules under this directory must keep reaching it through a
// dynamic import (no-eager-ai-imports.spec.ts).
import { Agent, type ToolsInput } from '@mastra/core/agent';
import { InMemoryStore } from '@mastra/core/storage';
import type { FullOutput } from '@mastra/core/stream';
import { createTool } from '@mastra/core/tools';
import { Memory } from '@mastra/memory';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';

import type { GetPageContentToolOutput } from '~/features/mastra/server/services/mastra-modules/tools/get-page-content-tool';

// --- What the AI entry (task 5.4 / 5.6) does with a generate result ---------

type OpenedPage = { readonly pageId: string; readonly path: string };

// The registration KEY in growiAgent's `tools` record, which is what Mastra
// reports as `toolName` (not the tool's `id`, 'get-page-content-tool').
const PAGE_TOOL_KEY = 'getPageContentTool';

const isOpenedPageOutput = (
  value: unknown,
): value is { result: 'ok'; page: OpenedPage } => {
  if (typeof value !== 'object' || value == null) return false;
  if (!('result' in value) || value.result !== 'ok') return false;
  if (!('page' in value)) return false;
  const { page } = value;
  return (
    typeof page === 'object' &&
    page != null &&
    'pageId' in page &&
    typeof page.pageId === 'string' &&
    'path' in page &&
    typeof page.path === 'string'
  );
};

// Same rules as the browser's extractPageSources (page-sources.ts): only the
// page-content tool, only `result: 'ok'`, deduplicated by pageId in
// first-seen order.
const extractOpenedPages = (
  result: Pick<FullOutput<unknown>, 'toolResults'>,
): OpenedPage[] => {
  const seen = new Set<string>();
  const pages: OpenedPage[] = [];
  for (const { payload } of result.toolResults) {
    if (payload.toolName !== PAGE_TOOL_KEY) continue;
    if (!isOpenedPageOutput(payload.result)) continue;
    const { pageId, path } = payload.result.page;
    if (seen.has(pageId)) continue;
    seen.add(pageId);
    pages.push({ pageId, path });
  }
  return pages;
};

type Settled<T> =
  | { readonly kind: 'completed'; readonly value: T }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'failed'; readonly error: unknown };

// How a caller must classify one generate call: by its own signal, on both the
// resolve and the reject path. An aborted run resolves and its result carries
// no abort marker, so the result alone cannot tell it from a completed run.
const settle = async <T>(
  run: Promise<T>,
  signal: AbortSignal,
): Promise<Settled<T>> => {
  try {
    const value = await run;
    return signal.aborted ? { kind: 'timeout' } : { kind: 'completed', value };
  } catch (error) {
    return signal.aborted ? { kind: 'timeout' } : { kind: 'failed', error };
  }
};

// --- Fake language model and tools (no network, no API key) -----------------

// Mastra's generate() drives the provider's doGenerate (doStream is unused), so
// each planned step is a doGenerate result, or a function to control timing.
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
  readonly toolName: string;
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

// A provider call that stays in flight until the request's abort signal fires,
// then rejects with the signal's reason, as fetch does.
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

const pageToolOutput = (pageId: string): GetPageContentToolOutput => {
  if (pageId === 'throws') throw new Error('tool exploded');
  if (pageId === 'denied') {
    return { result: 'not_found_or_forbidden', reason: 'denied' };
  }
  return {
    result: 'ok',
    page: { pageId, path: `/wiki/${pageId}`, totalLines: 1 },
  };
};

const pageInputSchema = z.object({ pageId: z.string() });

// Registered under the same key as in growiAgent; the id deliberately differs
// from that key, as it does there.
const fakePageTool = createTool({
  id: 'get-page-content-tool',
  description: 'Read a page',
  inputSchema: pageInputSchema,
  execute: async ({ pageId }) => pageToolOutput(pageId),
});

const fakeSearchTool = createTool({
  id: 'full-text-search-tool',
  description: 'Search pages',
  inputSchema: pageInputSchema,
  execute: async ({ pageId }) => pageToolOutput(pageId),
});

const agentWith = (
  model: MockLanguageModelV3,
  tools: ToolsInput = {
    getPageContentTool: fakePageTool,
    fullTextSearchTool: fakeSearchTool,
  },
  memory?: Memory,
): Agent =>
  new Agent({
    id: 'pinned-agent',
    name: 'pinned-agent',
    instructions: 'test',
    model,
    tools,
    ...(memory != null ? { memory } : {}),
  });

const pageCall = (id: string, pageId: string): PlannedToolCall => ({
  id,
  toolName: 'getPageContentTool',
  pageId,
});

// --- (1) Which pages did the tools open? -------------------------------------

describe('Mastra generate: pages opened by tools', () => {
  it('reports no tool results when the model answers without calling a tool', async () => {
    const result = await agentWith(planModel([textStep('hello')])).generate(
      'question',
      { maxSteps: 5 },
    );

    expect(result.text).toBe('hello');
    expect(result.toolResults).toEqual([]);
    expect(extractOpenedPages(result)).toEqual([]);
  });

  it('reports one tool result under the tool registration key, with the tool output as payload.result', async () => {
    const result = await agentWith(
      planModel([toolCallStep([pageCall('c1', 'p1')]), textStep('answer')]),
    ).generate('question', { maxSteps: 5 });

    expect(result.text).toBe('answer');
    expect(result.toolResults).toEqual([
      expect.objectContaining({
        type: 'tool-result',
        payload: expect.objectContaining({
          toolCallId: 'c1',
          toolName: 'getPageContentTool',
          args: { pageId: 'p1' },
          result: {
            result: 'ok',
            page: { pageId: 'p1', path: '/wiki/p1', totalLines: 1 },
          },
        }),
      }),
    ]);
    expect(extractOpenedPages(result)).toEqual([
      { pageId: 'p1', path: '/wiki/p1' },
    ]);
  });

  it('collects the tool results of every step, not only the last one', async () => {
    const result = await agentWith(
      planModel([
        toolCallStep([pageCall('c1', 'p1')]),
        toolCallStep([pageCall('c2', 'p2')]),
        textStep('answer'),
      ]),
    ).generate('question', { maxSteps: 5 });

    expect(result.steps.at(-1)?.toolResults).toEqual([]);
    expect(result.toolResults.map(({ payload }) => payload.toolCallId)).toEqual(
      ['c1', 'c2'],
    );
    expect(extractOpenedPages(result)).toEqual([
      { pageId: 'p1', path: '/wiki/p1' },
      { pageId: 'p2', path: '/wiki/p2' },
    ]);
  });

  it('omits a tool call that threw, and keeps a structured failure that the extraction must skip', async () => {
    const result = await agentWith(
      planModel([
        toolCallStep([pageCall('c1', 'p1'), pageCall('c2', 'throws')]),
        toolCallStep([pageCall('c3', 'denied')]),
        textStep('answer'),
      ]),
    ).generate('question', { maxSteps: 5 });

    expect(result.error).toBeUndefined();
    expect(result.toolCalls.map(({ payload }) => payload.toolCallId)).toEqual([
      'c1',
      'c2',
      'c3',
    ]);
    expect(result.toolResults.map(({ payload }) => payload.toolCallId)).toEqual(
      ['c1', 'c3'],
    );
    expect(extractOpenedPages(result)).toEqual([
      { pageId: 'p1', path: '/wiki/p1' },
    ]);
  });

  it('lists a page opened twice (outline, then a section) once, and ignores other tools', async () => {
    const result = await agentWith(
      planModel([
        toolCallStep([
          { id: 's1', toolName: 'fullTextSearchTool', pageId: 'p9' },
          pageCall('c1', 'p2'),
        ]),
        toolCallStep([pageCall('c2', 'p1'), pageCall('c3', 'p2')]),
        textStep('answer'),
      ]),
    ).generate('question', { maxSteps: 5 });

    expect(extractOpenedPages(result)).toEqual([
      { pageId: 'p2', path: '/wiki/p2' },
      { pageId: 'p1', path: '/wiki/p1' },
    ]);
  });

  it('reports only the current turn tool results when the run continues a remembered thread', async () => {
    const agent = agentWith(
      planModel([
        toolCallStep([pageCall('c1', 'p1')]),
        textStep('first'),
        textStep('second'),
      ]),
      undefined,
      new Memory({ storage: new InMemoryStore() }),
    );
    const memory = {
      thread: '123e4567-e89b-12d3-a456-426614174000',
      resource: 'user-1',
    };

    const first = await agent.generate('first question', {
      memory,
      maxSteps: 5,
    });
    const second = await agent.generate('second question', {
      memory,
      maxSteps: 5,
    });

    expect(extractOpenedPages(first)).toEqual([
      { pageId: 'p1', path: '/wiki/p1' },
    ]);
    expect(second.text).toBe('second');
    expect(second.toolResults).toEqual([]);
    expect(extractOpenedPages(second)).toEqual([]);
  });
});

// --- (2) An aborted generate resolves instead of throwing --------------------

const abortReasons: ReadonlyArray<readonly [string, () => unknown]> = [
  ['the default AbortError', () => undefined],
  [
    'a TimeoutError (as AbortSignal.timeout)',
    () => new DOMException('timed out', 'TimeoutError'),
  ],
  ['a plain Error', () => new Error('agent run timed out')],
];

const intentSchema = z.object({ intent: z.enum(['answer', 'summarize']) });

describe('Mastra generate: an aborted run', () => {
  it('resolves without calling the model when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const model = planModel([textStep('never')]);

    const pending = agentWith(model).generate('question', {
      abortSignal: controller.signal,
    });
    const settled = settle(pending, controller.signal);
    const result = await pending;

    expect(model.doGenerateCalls).toHaveLength(0);
    expect(result.text).toBe('');
    expect(result.error).toBeUndefined();
    expect(await settled).toEqual({ kind: 'timeout' });
  });

  it.each(
    abortReasons,
  )('resolves with empty text when aborted with %s while the first model call is in flight', async (_label, reasonOf) => {
    const controller = new AbortController();
    const inFlight = inFlightUntilAborted();
    const model = planModel([inFlight.step]);

    const pending = agentWith(model).generate('question', {
      abortSignal: controller.signal,
    });
    const settled = settle(pending, controller.signal);
    await inFlight.entered;
    controller.abort(reasonOf());
    const result = await pending;

    expect(model.doGenerateCalls[0]?.abortSignal).toBe(controller.signal);
    expect(result.text).toBe('');
    expect(result.steps).toEqual([]);
    expect(result.error).toBeUndefined();
    expect(await settled).toEqual({ kind: 'timeout' });
  });

  it('resolves with the text and tool results of the steps that finished before a later model call was aborted', async () => {
    const controller = new AbortController();
    const inFlight = inFlightUntilAborted();
    const model = planModel([
      toolCallStep([pageCall('c1', 'p1')], 'partial text '),
      inFlight.step,
    ]);

    const pending = agentWith(model).generate('question', {
      abortSignal: controller.signal,
      maxSteps: 5,
    });
    const settled = settle(pending, controller.signal);
    await inFlight.entered;
    controller.abort();
    const result = await pending;

    expect(result.text).toBe('partial text ');
    expect(extractOpenedPages(result)).toEqual([
      { pageId: 'p1', path: '/wiki/p1' },
    ]);
    expect(result.error).toBeUndefined();
    expect(await settled).toEqual({ kind: 'timeout' });
  });

  it('lets a running tool finish and does not call the model again when aborted mid-tool', async () => {
    const controller = new AbortController();
    let markToolEntered: () => void = () => {};
    const toolEntered = new Promise<void>((resolve) => {
      markToolEntered = resolve;
    });
    let releaseTool: () => void = () => {};
    const toolReleased = new Promise<void>((resolve) => {
      releaseTool = resolve;
    });
    const slowPageTool = createTool({
      id: 'get-page-content-tool',
      description: 'Read a page',
      inputSchema: pageInputSchema,
      execute: async ({ pageId }) => {
        markToolEntered();
        await toolReleased;
        return pageToolOutput(pageId);
      },
    });
    const model = planModel([
      toolCallStep([pageCall('c1', 'p1')]),
      textStep('never'),
    ]);

    const pending = agentWith(model, {
      getPageContentTool: slowPageTool,
    }).generate('question', { abortSignal: controller.signal, maxSteps: 5 });
    const settled = settle(pending, controller.signal);
    await toolEntered;
    controller.abort();
    releaseTool();
    const result = await pending;

    expect(model.doGenerateCalls).toHaveLength(1);
    expect(result.text).toBe('');
    expect(extractOpenedPages(result)).toEqual([
      { pageId: 'p1', path: '/wiki/p1' },
    ]);
    expect(await settled).toEqual({ kind: 'timeout' });
  });

  it('returns the whole answer with finishReason stop when the abort comes after the last model call', async () => {
    const controller = new AbortController();

    const pending = agentWith(planModel([textStep('full answer')])).generate(
      'question',
      {
        abortSignal: controller.signal,
        modelSettings: { maxRetries: 0 },
        // The run's own deadline firing after the model has answered, before
        // generate returns.
        onFinish: () => {
          controller.abort();
        },
      },
    );
    const settled = settle(pending, controller.signal);
    const result = await pending;

    expect(result.text).toBe('full answer');
    expect(result.finishReason).toBe('stop');
    expect(result.error).toBeUndefined();
    expect(controller.signal.aborted).toBe(true);
    expect(await settled).toEqual({ kind: 'timeout' });
  });

  it('saves the question and the partial answer of an aborted remembered run, and replays them on the next turn', async () => {
    const memory = new Memory({ storage: new InMemoryStore() });
    const thread = {
      thread: '123e4567-e89b-12d3-a456-426614174001',
      resource: 'user-1',
    };
    const controller = new AbortController();
    const inFlight = inFlightUntilAborted();
    const model = planModel([
      toolCallStep([pageCall('c1', 'p1')], 'partial text '),
      inFlight.step,
      textStep('next answer'),
    ]);
    const agent = agentWith(model, undefined, memory);

    const pending = agent.generate('first question', {
      memory: thread,
      maxSteps: 5,
      abortSignal: controller.signal,
      modelSettings: { maxRetries: 0 },
    });
    await inFlight.entered;
    controller.abort();
    await pending;
    const { messages } = await memory.recall({
      threadId: thread.thread,
      resourceId: thread.resource,
    });

    expect(
      messages.map((message) => [message.role, message.content.content]),
    ).toEqual([
      ['user', 'first question'],
      ['assistant', 'partial text '],
    ]);
    expect(messages[1]?.content.parts).toContainEqual(
      expect.objectContaining({
        type: 'tool-invocation',
        toolInvocation: expect.objectContaining({
          state: 'result',
          toolCallId: 'c1',
        }),
      }),
    );

    await agent.generate('second question', { memory: thread, maxSteps: 5 });

    expect(
      model.doGenerateCalls.at(-1)?.prompt.map((message) => message.role),
    ).toEqual(['system', 'user', 'assistant', 'tool', 'user']);
  });

  it('resolves with an undefined object when a structured-output run is aborted', async () => {
    const controller = new AbortController();
    const inFlight = inFlightUntilAborted();

    const pending = agentWith(planModel([inFlight.step])).generate('question', {
      structuredOutput: { schema: intentSchema },
      maxSteps: 1,
      abortSignal: controller.signal,
    });
    const settled = settle(pending, controller.signal);
    await inFlight.entered;
    controller.abort();
    const result = await pending;

    expect(result.object).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(await settled).toEqual({ kind: 'timeout' });
  });
});

describe('Mastra generate: runs that are not aborted', () => {
  // Mastra prints a failed run to console.error regardless of the agent logger.
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects when the provider fails', async () => {
    const controller = new AbortController();
    const model = planModel([() => Promise.reject(new Error('provider down'))]);

    const pending = agentWith(model).generate('question', {
      abortSignal: controller.signal,
      modelSettings: { maxRetries: 0 },
    });
    const settled = settle(pending, controller.signal);

    await expect(pending).rejects.toThrow('provider down');
    expect(await settled).toEqual({
      kind: 'failed',
      error: expect.objectContaining({ message: 'provider down' }),
    });
  });

  it('rejects when the structured output does not match the schema', async () => {
    const controller = new AbortController();

    const pending = agentWith(planModel([textStep('not json')])).generate(
      'question',
      {
        structuredOutput: { schema: intentSchema },
        maxSteps: 1,
        abortSignal: controller.signal,
      },
    );
    const settled = settle(pending, controller.signal);

    await expect(pending).rejects.toThrow(
      'Structured output validation failed',
    );
    expect(await settled).toEqual({ kind: 'failed', error: expect.any(Error) });
  });

  it('resolves a completed structured-output run with the parsed object', async () => {
    const controller = new AbortController();

    const settled = await settle(
      agentWith(planModel([textStep('{"intent":"summarize"}')])).generate(
        'question',
        {
          structuredOutput: { schema: intentSchema },
          maxSteps: 1,
          abortSignal: controller.signal,
        },
      ),
      controller.signal,
    );

    expect(settled).toEqual({
      kind: 'completed',
      value: expect.objectContaining({ object: { intent: 'summarize' } }),
    });
  });
});
