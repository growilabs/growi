// --- Mock boundary ---------------------------------------------------------
//
// These tests exercise the post-message ROUTE HANDLER's observable contract for
// model selection (Req 4.3, 4.6): what it forwards to the model resolver and to
// growiAgent.stream, NOT how the model is actually resolved (effective-model-key /
// resolve-provider-options own that, tested separately).
//
// We mock every module boundary the handler reaches so no real LLM is called:
//   - effective-model-key.resolveEffectiveModelKey: the single allow-list rounding
//     checkpoint — assert the route resolves the request's modelKey through it
//     EXACTLY once and threads the resolved key to both requestContext and the
//     options lookup (an out-of-available-set key is rounded to the default).
//   - resolve-provider-options.getProviderOptionsForModel: assert the route looks
//     up options for the RESOLVED key and passes them straight through to stream.
//   - mastra-modules: a stub growiAgent whose stream() records its options arg.
//   - get-or-create-thread: a fixed thread (thread plumbing is out of scope here).
//   - the `ai` package + @mastra/ai-sdk: stubbed so the handler can run to the
//     point where it pipes a stream, without a real UI message stream.
//   - chat-error-message: spied (not rewritten) so we can confirm the error path
//     stays wired to the existing sanitizer (Req 4.5).
import type { IUserHasId } from '@growi/core';
import type { Request, RequestHandler } from 'express';
import { mock } from 'vitest-mock-extended';

import type { UsageMeter } from '~/features/ai-usage/server';
import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

const { resolveEffectiveModelKey, getProviderOptionsForModel } = vi.hoisted(
  () => ({
    resolveEffectiveModelKey: vi.fn(),
    getProviderOptionsForModel: vi.fn(),
  }),
);
vi.mock('../services/ai-sdk-modules/llm-providers/effective-model-key', () => ({
  resolveEffectiveModelKey,
}));
vi.mock('../services/ai-sdk-modules/resolve-provider-options', () => ({
  getProviderOptionsForModel,
}));

const { stream, getMemory, getOrCreateThread } = vi.hoisted(() => ({
  stream: vi.fn(),
  getMemory: vi.fn(),
  getOrCreateThread: vi.fn(),
}));
vi.mock('../services/mastra-modules', () => ({
  mastra: {
    getAgent: () => ({ getMemory, stream }),
  },
}));
vi.mock('../services/get-or-create-thread', () => ({
  getOrCreateThread,
}));

// The validator chain (buildPostMessageValidator) needs express-validator's
// runtime, which cannot resolve lodash in this sandbox. We invoke the handler
// (the last middleware) directly, so stub the chain builder to keep the factory
// import side-effect-free.
vi.mock('./post-message-validator', () => ({
  buildPostMessageValidator: () => [],
}));

// `ai` is mocked so the handler can build/pipe a stream without a real one.
const { resolveChatErrorMessage } = vi.hoisted(() => ({
  resolveChatErrorMessage: vi.fn((): string => 'SAFE_MESSAGE'),
}));
vi.mock('./chat-error-message', () => ({ resolveChatErrorMessage }));

// Typed shape of the single argument the handler passes to createUIMessageStream,
// so its `onError` hook is introspectable in the error-path test.
type CreateUIMessageStreamArg = {
  originalMessages: unknown;
  onError: (error: unknown) => string;
  execute: (ctx: { writer: unknown }) => Promise<void>;
};
const { createUIMessageStream, pipeUIMessageStreamToResponse } = vi.hoisted(
  () => ({
    createUIMessageStream: vi.fn((_arg: CreateUIMessageStreamArg) => ({})),
    pipeUIMessageStreamToResponse: vi.fn(),
  }),
);
vi.mock('ai', () => ({
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
  validateUIMessages: vi.fn(),
}));
const { toAISdkStream } = vi.hoisted(() => ({
  toAISdkStream: vi.fn((): ReadableStream<unknown> => new ReadableStream()),
}));
vi.mock('@mastra/ai-sdk', () => ({ toAISdkStream }));

const { createUsageMeter } = vi.hoisted(() => ({
  createUsageMeter: vi.fn<(params: unknown) => UsageMeter>(),
}));
vi.mock('~/features/ai-usage/server', () => ({ createUsageMeter }));

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

import { RequestContext } from '@mastra/core/request-context';

import { postMessageHandlersFactory } from './post-message';

// The handler under test is the last middleware in the factory array.
const getHandler = (): RequestHandler => {
  const crowi = mock<Crowi>();
  const handlers = postMessageHandlersFactory(crowi);
  return handlers[handlers.length - 1];
};

const buildReqRes = (modelKey?: string) => {
  const user = mock<IUserHasId>();
  user._id = mock<IUserHasId['_id']>();
  user._id.toString = () => 'user-1';

  // Typed as a full express Request (+ the handler's `user`) so it satisfies
  // RequestHandler's parameter with no cast; the handler reads modelKey via
  // destructuring, so a concrete body is provided (rather than auto-stubbed).
  const req = mock<Request & { user: IUserHasId }>({
    body: {
      threadId: undefined,
      modelKey,
      messages: [{ id: '1', role: 'user', parts: [] }],
    },
    user,
  });
  const res = mock<ApiV3Response>();
  return { req, res };
};

// Invoke the route handler with the typed req/res mocks. The handler is exposed as
// a generic express RequestHandler; the mocks are typed to that signature's
// parameters (Request / Response), so the call needs no cast.
const invoke = (
  req: ReturnType<typeof buildReqRes>['req'],
  res: ReturnType<typeof buildReqRes>['res'],
): void | Promise<void> => getHandler()(req, res, vi.fn());

beforeEach(() => {
  vi.clearAllMocks();
  getMemory.mockResolvedValue({});
  getOrCreateThread.mockResolvedValue({ id: 'thread-1', resourceId: 'user-1' });
  // stream resolves to a usable stub: a readable-like + usage promise.
  stream.mockResolvedValue({
    usage: Promise.resolve({}),
  });
});

describe('post-message handler — model selection (Req 4.3, 4.6)', () => {
  it('resolves an in-set modelKey once and threads the resolved key to both requestContext and the options lookup (Req 4.3, 4.6)', async () => {
    const options = { openai: { reasoningEffort: 'low' } };
    // The resolver returns a sentinel distinct from the request value, so the test
    // proves BOTH sinks receive exactly the resolver's output (single-resolution
    // propagation) — not the raw request value nor two independent resolutions.
    const EFFECTIVE_KEY = 'openai/o3';
    resolveEffectiveModelKey.mockReturnValue(EFFECTIVE_KEY);
    getProviderOptionsForModel.mockReturnValue(options);

    const { req, res } = buildReqRes('openai/o3');
    await invoke(req, res);

    // The route rounds the request's modelKey through resolveEffectiveModelKey
    // exactly once (the single checkpoint), then threads the resolved key everywhere.
    expect(resolveEffectiveModelKey).toHaveBeenCalledTimes(1);
    expect(resolveEffectiveModelKey).toHaveBeenCalledWith('openai/o3');
    expect(getProviderOptionsForModel).toHaveBeenCalledWith(EFFECTIVE_KEY);

    expect(stream).toHaveBeenCalledTimes(1);
    const streamOptions = stream.mock.calls[0][1];
    // requestContext carries the RESOLVED model key for the agent's dynamic model fn.
    expect(streamOptions.requestContext).toBeInstanceOf(RequestContext);
    expect(streamOptions.requestContext.get('modelKey')).toBe(EFFECTIVE_KEY);
    // providerOptions forwarded verbatim from the lookup (effective model's options).
    expect(streamOptions.providerOptions).toBe(options);
  });

  it('rounds an out-of-set modelKey to the effective default and propagates only the resolved default (Req 4.6)', async () => {
    const defaultOptions = { openai: { reasoningEffort: 'high' } };
    // resolveEffectiveModelKey collapses an out-of-available-set key to the default.
    const DEFAULT_KEY = 'openai/gpt-4o';
    resolveEffectiveModelKey.mockReturnValue(DEFAULT_KEY);
    getProviderOptionsForModel.mockReturnValue(defaultOptions);

    const { req, res } = buildReqRes('anthropic/not-allowed');
    await invoke(req, res);

    expect(resolveEffectiveModelKey).toHaveBeenCalledWith(
      'anthropic/not-allowed',
    );
    // The RESOLVED default key (not the raw client value) is what reaches both
    // sinks, so the agent model fn never re-rounds (no second warning).
    expect(getProviderOptionsForModel).toHaveBeenCalledWith(DEFAULT_KEY);

    const streamOptions = stream.mock.calls[0][1];
    expect(streamOptions.requestContext.get('modelKey')).toBe(DEFAULT_KEY);
    expect(streamOptions.providerOptions).toBe(defaultOptions);
  });

  it('rounds an omitted modelKey to the default and threads the resolved default key (Req 4.6)', async () => {
    const defaultOptions = { openai: { reasoningEffort: 'high' } };
    const DEFAULT_KEY = 'openai/gpt-4o';
    resolveEffectiveModelKey.mockReturnValue(DEFAULT_KEY);
    getProviderOptionsForModel.mockReturnValue(defaultOptions);

    const { req, res } = buildReqRes(undefined);
    await invoke(req, res);

    expect(resolveEffectiveModelKey).toHaveBeenCalledWith(undefined);
    expect(getProviderOptionsForModel).toHaveBeenCalledWith(DEFAULT_KEY);

    const streamOptions = stream.mock.calls[0][1];
    expect(streamOptions.requestContext.get('modelKey')).toBe(DEFAULT_KEY);
    expect(streamOptions.providerOptions).toBe(defaultOptions);
  });

  it('keeps the existing error sanitizer wired so provider errors yield a safe message (Req 4.5)', async () => {
    resolveEffectiveModelKey.mockReturnValue('openai/o3');
    getProviderOptionsForModel.mockReturnValue({});

    const { req, res } = buildReqRes('openai/o3');
    await invoke(req, res);

    // createUIMessageStream receives an onError hook; the handler must route it
    // through resolveChatErrorMessage (the existing, unchanged sanitizer).
    const createArgs = createUIMessageStream.mock.calls[0][0];
    const safe = createArgs.onError(new Error('boom: secret leak'));
    expect(resolveChatErrorMessage).toHaveBeenCalledWith(expect.any(Error));
    expect(safe).toBe('SAFE_MESSAGE');
  });
});

describe('post-message handler — usage metering (Req 2.1, 2.6, 2.7)', () => {
  const MODEL_KEY = 'openai/gpt-4o';

  // A stream that yields the given chunks, then either ends or fails.
  const readableOf = (
    chunks: readonly unknown[],
    failure?: Error,
  ): ReadableStream<unknown> =>
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        if (failure != null) {
          controller.error(failure);
          return;
        }
        controller.close();
      },
    });

  const agentOutput = (finishReason: string) => ({
    usage: Promise.resolve({}),
    finishReason: Promise.resolve(finishReason),
    steps: Promise.resolve([]),
  });

  // Run the UI stream's execute the way createUIMessageStream would.
  const runExecute = async (): Promise<void> => {
    const { execute } = createUIMessageStream.mock.calls[0][0];
    await execute({ writer: { write: vi.fn() } });
  };

  let meter: UsageMeter;

  beforeEach(() => {
    resolveEffectiveModelKey.mockReturnValue(MODEL_KEY);
    getProviderOptionsForModel.mockReturnValue({});
    meter = mock<UsageMeter>();
    createUsageMeter.mockReturnValue(meter);
  });

  it('creates a chat meter for the user and the resolved model key and hands it to the agent', async () => {
    const { req, res } = buildReqRes('openai/o3');
    await invoke(req, res);

    expect(createUsageMeter).toHaveBeenCalledTimes(1);
    expect(createUsageMeter).toHaveBeenCalledWith({
      userId: 'user-1',
      feature: 'chat',
      modelKey: MODEL_KEY,
    });
    const streamOptions = stream.mock.calls[0][1];
    expect(streamOptions.requestContext.get('usageMeter')).toBe(meter);
  });

  it('closes the meter as completed once the stream has been read to the end', async () => {
    stream.mockResolvedValue(agentOutput('stop'));
    toAISdkStream.mockReturnValue(readableOf([{ type: 'text-delta' }]));

    const { req, res } = buildReqRes(MODEL_KEY);
    await invoke(req, res);
    expect(meter.close).not.toHaveBeenCalled();

    await runExecute();

    expect(meter.close).toHaveBeenCalledTimes(1);
    expect(meter.close).toHaveBeenCalledWith({ outcome: 'completed' });
  });

  it('closes the meter as failed when the stream ends with an error finish reason', async () => {
    stream.mockResolvedValue(agentOutput('error'));
    toAISdkStream.mockReturnValue(readableOf([{ type: 'error' }]));

    const { req, res } = buildReqRes(MODEL_KEY);
    await invoke(req, res);
    await runExecute();

    expect(meter.close).toHaveBeenCalledTimes(1);
    expect(meter.close).toHaveBeenCalledWith({ outcome: 'failed' });
  });

  it('closes the meter as failed when reading the stream throws mid-way', async () => {
    stream.mockResolvedValue(agentOutput('stop'));
    toAISdkStream.mockReturnValue(
      readableOf([{ type: 'text-delta' }], new Error('connection lost')),
    );

    const { req, res } = buildReqRes(MODEL_KEY);
    await invoke(req, res);
    await expect(runExecute()).rejects.toThrow('connection lost');

    expect(meter.close).toHaveBeenCalledTimes(1);
    expect(meter.close).toHaveBeenCalledWith({ outcome: 'failed' });
  });

  it('closes the meter as failed when the agent stream call itself fails, keeping the error response', async () => {
    stream.mockRejectedValue(new Error('model misconfigured'));

    const { req, res } = buildReqRes(MODEL_KEY);
    res.headersSent = false;
    await invoke(req, res);

    expect(meter.close).toHaveBeenCalledTimes(1);
    expect(meter.close).toHaveBeenCalledWith({ outcome: 'failed' });
    expect(res.apiv3Err).toHaveBeenCalledTimes(1);
  });
});
