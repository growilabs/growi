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
//   - the UserUISettings model: the per-user persisted selection. We stub
//     findOne(...).lean() so no DB is touched.
// resolveEffectiveModelKey (effective-model-key) is left REAL: the handler
// delegates the initial-selection rule to that SINGLE checkpoint (Req 4.6), so we
// exercise the real integrated resolution here rather than re-asserting a mock's
// return. Its own unit tests live in effective-model-key.spec. The pure key helpers
// (buildModelKey / parseModelKey / isModelInAllowList) are likewise REAL — they are
// the observable mapping/membership rules and mocking them would test the mechanism.
// The handler under test is the last middleware in the factory array (the
// preceding auth/validator middlewares are mocked out so the factory import is
// side-effect-free), mirroring post-message-handler.spec.
import type { IUserHasId } from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
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

// buildModelDisplayNameResolver joins the allow-list with the effective catalog
// to attach official display names. Mocked at its module boundary (like
// getAvailableModels) so this handler test stays a pure map-contract test and
// touches no catalog/DB; its own resolution is unit-tested in
// resolve-model-display-name.spec. The mock returns a deterministic resolver so
// the assertions can pin the exact displayName the handler emits.
const { buildModelDisplayNameResolver } = vi.hoisted(() => ({
  buildModelDisplayNameResolver: vi.fn(),
}));
vi.mock('../services/ai-sdk-modules/resolve-model-display-name', () => ({
  buildModelDisplayNameResolver,
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
  // shape introspectable. Typed as a full express Request (+ the handler's `user`)
  // and ApiV3Response so they satisfy RequestHandler's parameters with no cast.
  user._id = mock<IUserHasId['_id']>();
  const req = mock<Request & { user: IUserHasId }>({ user });
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
  // Deterministic display-name resolver: "Name of <modelId>". Reset per test so a
  // test that never sets getAvailableModels still has a valid resolver.
  buildModelDisplayNameResolver.mockResolvedValue(
    (_provider: string, modelId: string) => `Name of ${modelId}`,
  );
});

describe('get-models handler (Req 4.1, 4.2, 4.4, 4.5)', () => {
  it('returns only available providers models, each with key/provider/modelId/displayName in allow-list order (Req 4.1, 4.2)', async () => {
    getAvailableModels.mockReturnValue(AVAILABLE_MODELS);
    mockSavedSelection(undefined);

    const { req, res } = buildReqRes();
    await invoke(req, res);

    expect(res.apiv3).toHaveBeenCalledTimes(1);
    const payload = res.apiv3.mock.calls[0][0];
    expect(payload.models).toEqual([
      {
        key: 'openai/gpt-4o',
        provider: 'openai',
        modelId: 'gpt-4o',
        displayName: 'Name of gpt-4o',
      },
      {
        key: 'anthropic/claude-3-5-sonnet',
        provider: 'anthropic',
        modelId: 'claude-3-5-sonnet',
        displayName: 'Name of claude-3-5-sonnet',
      },
    ]);
    // A provider absent from the available set (e.g. disabled google) never
    // appears in the response — the handler surfaces the available set as-is.
    expect(payload.models.some((m) => m.provider === 'google')).toBe(false);
  });

  it('never leaks providerOptions on any entry (Security)', async () => {
    getAvailableModels.mockReturnValue(AVAILABLE_MODELS);
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
    // The saved key is in the set, so it wins over the (different) effective
    // default 'anthropic/claude-3-5-sonnet' that the set would otherwise resolve to.
    mockSavedSelection('openai/gpt-4o');

    const { req, res } = buildReqRes();
    await invoke(req, res);

    const payload = res.apiv3.mock.calls[0][0];
    expect(payload.selectedModelKey).toBe('openai/gpt-4o');
  });

  it('falls back to the effective default when there is no persisted selection (Req 4.5)', async () => {
    getAvailableModels.mockReturnValue(AVAILABLE_MODELS);
    mockSavedSelection(undefined);

    const { req, res } = buildReqRes();
    await invoke(req, res);

    const payload = res.apiv3.mock.calls[0][0];
    expect(payload.selectedModelKey).toBe('anthropic/claude-3-5-sonnet');
  });

  it('falls back to the effective default when the persisted key is unparseable (Req 4.5)', async () => {
    getAvailableModels.mockReturnValue(AVAILABLE_MODELS);
    // No '/' separator / unknown provider prefix -> parseModelKey returns null.
    mockSavedSelection('garbage-without-separator');

    const { req, res } = buildReqRes();
    await invoke(req, res);

    const payload = res.apiv3.mock.calls[0][0];
    expect(payload.selectedModelKey).toBe('anthropic/claude-3-5-sonnet');
  });

  it('falls back to the effective default when the persisted keys provider is no longer available (Req 4.5)', async () => {
    getAvailableModels.mockReturnValue(AVAILABLE_MODELS);
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
    // TOCTOU where the available set was emptied after the guard. Resolving an
    // empty set throws (real resolveEffectiveModelKey), which must fail soft to an
    // error response rather than returning an undefined selectedModelKey.
    getAvailableModels.mockReturnValue([]);
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
