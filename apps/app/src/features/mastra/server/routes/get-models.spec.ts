// --- Mock boundary ---------------------------------------------------------
//
// These tests exercise the GET /mastra/models ROUTE HANDLER's observable
// contract (task 5.3 / Req 4.1, 4.2, 4.4, 4.5): the JSON it returns given the
// AVAILABLE (enabled AND configured) model set, the effective default, and the
// requesting user's persisted selection. We mock every module boundary the
// handler reaches:
//   - getAvailableModels (provider-availability): the allow-list already
//     filtered to enabled ∧ configured providers (Req 4.1 / 6.1). Owned and
//     tested by ai-sdk-modules; here we treat its return as the given.
//   - getEffectiveDefaultModelKey (effective-model-key): the server-resolved
//     fallback selection. Owned and tested by ai-sdk-modules.
//   - the UserUISettings model: the per-user persisted selection. We stub
//     findOne(...).lean() so no DB is touched.
// The pure key helpers (buildModelKey / parseModelKey / isModelInAllowList) are
// left REAL — they are the observable mapping/membership rules and mocking them
// would test the mechanism, not the contract.
// The handler under test is the last middleware in the factory array (the
// preceding auth/validator middlewares are mocked out so the factory import is
// side-effect-free), mirroring post-message-handler.spec.
import type { IUserHasId } from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import type { RequestHandler } from 'express';
import { mock } from 'vitest-mock-extended';

import type { AllowedModel } from '~/features/mastra/interfaces/allowed-model';
import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

const { getAvailableModels } = vi.hoisted(() => ({
  getAvailableModels: vi.fn(),
}));
vi.mock(
  '../services/ai-sdk-modules/llm-providers/provider-availability',
  () => ({ getAvailableModels }),
);

const { getEffectiveDefaultModelKey } = vi.hoisted(() => ({
  getEffectiveDefaultModelKey: vi.fn(),
}));
vi.mock('../services/ai-sdk-modules/llm-providers/effective-model-key', () => ({
  getEffectiveDefaultModelKey,
}));

// UserUISettings is a default export; the handler reads the user's persisted
// selection via UserUISettings.findOne(...).lean().
const { findOne, lean } = vi.hoisted(() => ({
  findOne: vi.fn(),
  lean: vi.fn(),
}));
vi.mock('~/server/models/user-ui-settings', () => ({
  default: { findOne },
}));

vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser: () => vi.fn(),
}));
vi.mock('~/server/middlewares/login-required', () => ({
  default: () => vi.fn(),
}));
vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { getModelsFactory } from './get-models';

const getHandler = (): RequestHandler => {
  const crowi = mock<Crowi>();
  const handlers = getModelsFactory(crowi);
  return handlers[handlers.length - 1];
};

const buildReqRes = () => {
  const user = mock<IUserHasId>();
  // _id is read for the UserUISettings lookup; a concrete value keeps the query
  // shape introspectable.
  user._id = mock<IUserHasId['_id']>();
  const req = mock<{ user: IUserHasId }>({ user });
  const res = mock<ApiV3Response>();
  return { req, res };
};

// Invoke the route handler with the typed req/res mocks. The handler is pulled from
// the factory as a generic express RequestHandler, which erases its real
// (Req, ApiV3Response) signature; the single cast that bridges the narrow mocks to
// that signature is confined HERE, so the call sites stay cast-free.
const invoke = (
  req: ReturnType<typeof buildReqRes>['req'],
  res: ReturnType<typeof buildReqRes>['res'],
): void | Promise<void> =>
  // biome-ignore lint/suspicious/noExplicitAny: one confined cast at the invoke boundary
  getHandler()(req as any, res as any, vi.fn());

// Set the per-user persisted selection the handler will read (a modelKey).
const mockSavedSelection = (aiChatSelectedModelKey?: string) => {
  lean.mockResolvedValue(
    aiChatSelectedModelKey != null ? { aiChatSelectedModelKey } : null,
  );
  findOne.mockReturnValue({ lean });
};

// Two available providers' models; google is intentionally ABSENT to stand in
// for a disabled/misconfigured provider (getAvailableModels is the filter).
const AVAILABLE_MODELS: AllowedModel[] = [
  {
    provider: 'openai',
    modelId: 'gpt-4o',
    providerOptions: { openai: { reasoningEffort: 'low' } },
  },
  { provider: 'anthropic', modelId: 'claude-3-5-sonnet', isDefault: true },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('get-models handler (Req 4.1, 4.2, 4.4, 4.5)', () => {
  it('returns only available providers models, each with key/provider/modelId in allow-list order (Req 4.1, 4.2)', async () => {
    getAvailableModels.mockReturnValue(AVAILABLE_MODELS);
    getEffectiveDefaultModelKey.mockReturnValue('anthropic/claude-3-5-sonnet');
    mockSavedSelection(undefined);

    const { req, res } = buildReqRes();
    await invoke(req, res);

    expect(res.apiv3).toHaveBeenCalledTimes(1);
    const payload = res.apiv3.mock.calls[0][0];
    expect(payload.models).toEqual([
      { key: 'openai/gpt-4o', provider: 'openai', modelId: 'gpt-4o' },
      {
        key: 'anthropic/claude-3-5-sonnet',
        provider: 'anthropic',
        modelId: 'claude-3-5-sonnet',
      },
    ]);
    // A provider absent from the available set (e.g. disabled google) never
    // appears in the response — the handler surfaces the available set as-is.
    expect(payload.models.some((m) => m.provider === 'google')).toBe(false);
  });

  it('never leaks providerOptions on any entry (Security)', async () => {
    getAvailableModels.mockReturnValue(AVAILABLE_MODELS);
    getEffectiveDefaultModelKey.mockReturnValue('anthropic/claude-3-5-sonnet');
    mockSavedSelection(undefined);

    const { req, res } = buildReqRes();
    await invoke(req, res);

    const payload = res.apiv3.mock.calls[0][0];
    for (const entry of payload.models) {
      expect(entry).not.toHaveProperty('providerOptions');
    }
    expect(JSON.stringify(payload)).not.toContain('providerOptions');
    expect(JSON.stringify(payload)).not.toContain('reasoningEffort');
  });

  it('uses the persisted selection as selectedModelKey when it is in the available set (Req 4.4)', async () => {
    getAvailableModels.mockReturnValue(AVAILABLE_MODELS);
    // A DIFFERENT default proves the saved key wins over the fallback.
    getEffectiveDefaultModelKey.mockReturnValue('anthropic/claude-3-5-sonnet');
    mockSavedSelection('openai/gpt-4o');

    const { req, res } = buildReqRes();
    await invoke(req, res);

    const payload = res.apiv3.mock.calls[0][0];
    expect(payload.selectedModelKey).toBe('openai/gpt-4o');
    expect(getEffectiveDefaultModelKey).not.toHaveBeenCalled();
  });

  it('falls back to the effective default when there is no persisted selection (Req 4.5)', async () => {
    getAvailableModels.mockReturnValue(AVAILABLE_MODELS);
    getEffectiveDefaultModelKey.mockReturnValue('anthropic/claude-3-5-sonnet');
    mockSavedSelection(undefined);

    const { req, res } = buildReqRes();
    await invoke(req, res);

    const payload = res.apiv3.mock.calls[0][0];
    expect(payload.selectedModelKey).toBe('anthropic/claude-3-5-sonnet');
  });

  it('falls back to the effective default when the persisted key is unparseable (Req 4.5)', async () => {
    getAvailableModels.mockReturnValue(AVAILABLE_MODELS);
    getEffectiveDefaultModelKey.mockReturnValue('anthropic/claude-3-5-sonnet');
    // No '/' separator / unknown provider prefix -> parseModelKey returns null.
    mockSavedSelection('garbage-without-separator');

    const { req, res } = buildReqRes();
    await invoke(req, res);

    const payload = res.apiv3.mock.calls[0][0];
    expect(payload.selectedModelKey).toBe('anthropic/claude-3-5-sonnet');
  });

  it('falls back to the effective default when the persisted keys provider is no longer available (Req 4.5)', async () => {
    getAvailableModels.mockReturnValue(AVAILABLE_MODELS);
    getEffectiveDefaultModelKey.mockReturnValue('anthropic/claude-3-5-sonnet');
    // Parses fine, but google is not in the available set (provider disabled),
    // so isModelInAllowList against the available set fails -> default.
    mockSavedSelection('google/gemini-1.5-pro');

    const { req, res } = buildReqRes();
    await invoke(req, res);

    const payload = res.apiv3.mock.calls[0][0];
    expect(payload.selectedModelKey).toBe('anthropic/claude-3-5-sonnet');
  });

  it('responds with an error and no undefined selection when the available set is empty (guard TOCTOU)', async () => {
    // aiReadyGuard normally returns 501 before reaching here; this is the rare
    // TOCTOU where the available set was emptied after the guard.
    // getEffectiveDefaultModelKey throws on an empty set, which must fail soft
    // to an error response rather than returning an undefined selectedModelKey.
    getAvailableModels.mockReturnValue([]);
    getEffectiveDefaultModelKey.mockImplementation(() => {
      throw new Error('No available AI model to resolve');
    });
    mockSavedSelection(undefined);

    const { req, res } = buildReqRes();
    await invoke(req, res);

    expect(res.apiv3).not.toHaveBeenCalled();
    expect(res.apiv3Err).toHaveBeenCalledTimes(1);
    // Must be a server-side 500, NOT the apiv3Err default of 400: this is a
    // server-side failure per the route's Errors contract (501 guard, 500).
    // Asserting the status here locks the contract so it can't silently regress.
    expect(res.apiv3Err).toHaveBeenCalledWith(expect.any(ErrorV3), 500);
  });
});
