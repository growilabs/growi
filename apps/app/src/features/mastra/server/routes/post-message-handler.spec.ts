// --- Mock boundary ---------------------------------------------------------
//
// These tests exercise the post-message ROUTE HANDLER's observable contract for
// model selection (task 3.1 / Req 3.3, 4.1–4.5): what it forwards to the model
// resolver and to growiAgent.stream, NOT how the model is actually resolved
// (resolve-provider-options / resolve-mastra-model own that, tested separately).
//
// We mock every module boundary the handler reaches so no real LLM is called:
//   - config.resolveEffectiveModel: the single allow-list rounding checkpoint —
//     assert the route resolves the request's modelId through it EXACTLY once and
//     threads the resolved id to both requestContext and the options lookup.
//   - resolve-provider-options.getProviderOptionsForModel: assert the route looks
//     up options for the RESOLVED id and passes them straight through to stream.
//   - mastra-modules: a stub growiAgent whose stream() records its options arg.
//   - get-or-create-thread: a fixed thread (thread plumbing is out of scope here).
//   - the `ai` package + @mastra/ai-sdk: stubbed so the handler can run to the
//     point where it pipes a stream, without a real UI message stream.
//   - chat-error-message: spied (not rewritten) so we can confirm the error path
//     stays wired to the existing sanitizer (Req 4.5).
import type { IUserHasId } from '@growi/core';
import type { RequestHandler } from 'express';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

const { resolveEffectiveModel, getProviderOptionsForModel } = vi.hoisted(
  () => ({
    resolveEffectiveModel: vi.fn(),
    getProviderOptionsForModel: vi.fn(),
  }),
);
vi.mock('../services/ai-sdk-modules/llm-providers/config', () => ({
  resolveEffectiveModel,
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
vi.mock('@mastra/ai-sdk', () => ({
  toAISdkStream: vi.fn(),
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

import { RequestContext } from '@mastra/core/request-context';

import { postMessageHandlersFactory } from './post-message';

// The handler under test is the last middleware in the factory array.
const getHandler = (): RequestHandler => {
  const crowi = mock<Crowi>();
  const handlers = postMessageHandlersFactory(crowi);
  return handlers[handlers.length - 1];
};

const buildReqRes = (modelId?: string) => {
  const user = mock<IUserHasId>();
  user._id = mock<IUserHasId['_id']>();
  user._id.toString = () => 'user-1';

  // The handler reads modelId via destructuring; mock<Request> would auto-stub
  // body fields, so we provide a concrete body.
  const req = mock<{ body: unknown; user: IUserHasId }>({
    body: {
      threadId: undefined,
      modelId,
      messages: [{ id: '1', role: 'user', parts: [] }],
    },
    user,
  });
  const res = mock<ApiV3Response>();
  return { req, res };
};

beforeEach(() => {
  vi.clearAllMocks();
  getMemory.mockResolvedValue({});
  getOrCreateThread.mockResolvedValue({ id: 'thread-1', resourceId: 'user-1' });
  // stream resolves to a usable stub: a readable-like + usage promise.
  stream.mockResolvedValue({
    usage: Promise.resolve({}),
  });
});

describe('post-message handler — model selection (Req 3.3, 4.1, 4.3, 4.4)', () => {
  it('resolves an in-allowlist modelId once and threads the resolved id to both requestContext and the options lookup (Req 4.1, 4.4)', async () => {
    const options = { openai: { reasoningEffort: 'low' } };
    resolveEffectiveModel.mockReturnValue('o3');
    getProviderOptionsForModel.mockReturnValue(options);

    const { req, res } = buildReqRes('o3');
    // biome-ignore lint/suspicious/noExplicitAny: invoking the express handler with mocked req/res
    await getHandler()(req as any, res as any, vi.fn());

    // The route rounds the request's modelId through resolveEffectiveModel exactly
    // once (the single checkpoint), then threads the resolved id everywhere.
    expect(resolveEffectiveModel).toHaveBeenCalledTimes(1);
    expect(resolveEffectiveModel).toHaveBeenCalledWith('o3');
    expect(getProviderOptionsForModel).toHaveBeenCalledWith('o3');

    expect(stream).toHaveBeenCalledTimes(1);
    const streamOptions = stream.mock.calls[0][1];
    // requestContext carries the RESOLVED model id for the agent's dynamic model fn.
    expect(streamOptions.requestContext).toBeInstanceOf(RequestContext);
    expect(streamOptions.requestContext.get('modelId')).toBe('o3');
    // providerOptions forwarded verbatim from the lookup (effective model's options).
    expect(streamOptions.providerOptions).toBe(options);
  });

  it('rounds an omitted modelId to the default and threads the resolved default id (Req 4.3)', async () => {
    const defaultOptions = { openai: { reasoningEffort: 'high' } };
    // resolveEffectiveModel collapses an undefined modelId to the default id.
    resolveEffectiveModel.mockReturnValue('gpt-4o');
    getProviderOptionsForModel.mockReturnValue(defaultOptions);

    const { req, res } = buildReqRes(undefined);
    // biome-ignore lint/suspicious/noExplicitAny: invoking the express handler with mocked req/res
    await getHandler()(req as any, res as any, vi.fn());

    expect(resolveEffectiveModel).toHaveBeenCalledWith(undefined);
    // The RESOLVED default id (not undefined) is threaded downstream, so the agent
    // model fn never re-rounds (no second warning).
    expect(getProviderOptionsForModel).toHaveBeenCalledWith('gpt-4o');

    const streamOptions = stream.mock.calls[0][1];
    expect(streamOptions.requestContext.get('modelId')).toBe('gpt-4o');
    expect(streamOptions.providerOptions).toBe(defaultOptions);
  });

  it('keeps the existing error sanitizer wired so provider errors yield a safe message (Req 4.5)', async () => {
    resolveEffectiveModel.mockReturnValue('o3');
    getProviderOptionsForModel.mockReturnValue({});

    const { req, res } = buildReqRes('o3');
    // biome-ignore lint/suspicious/noExplicitAny: invoking the express handler with mocked req/res
    await getHandler()(req as any, res as any, vi.fn());

    // createUIMessageStream receives an onError hook; the handler must route it
    // through resolveChatErrorMessage (the existing, unchanged sanitizer).
    const createArgs = createUIMessageStream.mock.calls[0][0];
    const safe = createArgs.onError(new Error('boom: secret leak'));
    expect(resolveChatErrorMessage).toHaveBeenCalledWith(expect.any(Error));
    expect(safe).toBe('SAFE_MESSAGE');
  });
});
