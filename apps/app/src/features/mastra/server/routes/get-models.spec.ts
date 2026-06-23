// --- Mock boundary ---------------------------------------------------------
//
// These tests exercise the GET /mastra/models ROUTE HANDLER's observable
// contract (task 3.2 / Req 3.1, 3.2, 3.7): the JSON it returns given an
// allow-list, a default model, and the requesting user's persisted selection.
// We mock every module boundary the handler reaches:
//   - the config accessors (getAllowedModels / getDefaultModel): the allow-list
//     and default are owned by ai-sdk-modules and tested there.
//   - the UserUISettings model: the per-user persisted selection. We stub
//     findOne(...).lean() so no DB is touched.
// The handler under test is the last middleware in the factory array (the
// preceding auth/validator middlewares are mocked out so the factory import is
// side-effect-free), mirroring post-message-handler.spec.
import type { IUserHasId } from '@growi/core';
import type { RequestHandler } from 'express';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

const { getAllowedModels, getDefaultModel } = vi.hoisted(() => ({
  getAllowedModels: vi.fn(),
  getDefaultModel: vi.fn(),
}));
vi.mock('../services/ai-sdk-modules/llm-providers/config', () => ({
  getAllowedModels,
  getDefaultModel,
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

// Set the per-user persisted selection the handler will read.
const mockSavedSelection = (aiChatSelectedModel?: string) => {
  lean.mockResolvedValue(
    aiChatSelectedModel != null ? { aiChatSelectedModel } : null,
  );
  findOne.mockReturnValue({ lean });
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('get-models handler (Req 3.1, 3.2, 3.7)', () => {
  it('returns the allow-list model ids and the server-validated selection (Req 3.1, 3.2)', async () => {
    getAllowedModels.mockReturnValue([
      {
        model: 'gpt-4o',
        providerOptions: { openai: { reasoningEffort: 'low' } },
      },
      { model: 'o3', isDefault: true },
    ]);
    getDefaultModel.mockReturnValue('o3');
    mockSavedSelection('o3');

    const { req, res } = buildReqRes();
    // biome-ignore lint/suspicious/noExplicitAny: invoking the express handler with mocked req/res
    await getHandler()(req as any, res as any, vi.fn());

    expect(res.apiv3).toHaveBeenCalledTimes(1);
    const payload = res.apiv3.mock.calls[0][0];
    // Plain model-id array (no id/name objects) and the resolved selection only —
    // defaultModelId is no longer on the wire (the client never consumed it).
    expect(payload.models).toEqual(['gpt-4o', 'o3']);
    expect(payload.selectedModelId).toBe('o3');
    expect(payload).not.toHaveProperty('defaultModelId');
  });

  it('responds with an error when no default is resolvable (allow-list emptied after the guard)', async () => {
    // aiReadyGuard normally guarantees a non-empty allow-list; this is the rare
    // TOCTOU where it was cleared between the guard and the handler. The handler
    // must not return a selection-less response — it errors instead.
    getAllowedModels.mockReturnValue([]);
    getDefaultModel.mockReturnValue(undefined);
    mockSavedSelection(undefined);

    const { req, res } = buildReqRes();
    // biome-ignore lint/suspicious/noExplicitAny: invoking the express handler with mocked req/res
    await getHandler()(req as any, res as any, vi.fn());

    expect(res.apiv3).not.toHaveBeenCalled();
    expect(res.apiv3Err).toHaveBeenCalledTimes(1);
  });

  it('never leaks providerOptions anywhere in the response (Security)', async () => {
    getAllowedModels.mockReturnValue([
      {
        model: 'gpt-4o',
        providerOptions: { openai: { reasoningEffort: 'low' } },
        isDefault: true,
      },
    ]);
    getDefaultModel.mockReturnValue('gpt-4o');
    mockSavedSelection('gpt-4o');

    const { req, res } = buildReqRes();
    // biome-ignore lint/suspicious/noExplicitAny: invoking the express handler with mocked req/res
    await getHandler()(req as any, res as any, vi.fn());

    const payload = res.apiv3.mock.calls[0][0];
    expect(JSON.stringify(payload)).not.toContain('providerOptions');
    expect(JSON.stringify(payload)).not.toContain('reasoningEffort');
  });

  it('returns the saved selection as selectedModelId when it is in the allow-list (Req 3.2)', async () => {
    getAllowedModels.mockReturnValue([
      { model: 'gpt-4o', isDefault: true },
      { model: 'o3' },
    ]);
    getDefaultModel.mockReturnValue('gpt-4o');
    mockSavedSelection('o3');

    const { req, res } = buildReqRes();
    // biome-ignore lint/suspicious/noExplicitAny: invoking the express handler with mocked req/res
    await getHandler()(req as any, res as any, vi.fn());

    const payload = res.apiv3.mock.calls[0][0];
    expect(payload.selectedModelId).toBe('o3');
  });

  it('falls back to the default when the saved selection is NOT in the allow-list (Req 3.7)', async () => {
    getAllowedModels.mockReturnValue([
      { model: 'gpt-4o', isDefault: true },
      { model: 'o3' },
    ]);
    getDefaultModel.mockReturnValue('gpt-4o');
    mockSavedSelection('removed-model');

    const { req, res } = buildReqRes();
    // biome-ignore lint/suspicious/noExplicitAny: invoking the express handler with mocked req/res
    await getHandler()(req as any, res as any, vi.fn());

    const payload = res.apiv3.mock.calls[0][0];
    expect(payload.selectedModelId).toBe('gpt-4o');
  });

  it('falls back to the default when the user has no saved selection (Req 3.7)', async () => {
    getAllowedModels.mockReturnValue([
      { model: 'gpt-4o', isDefault: true },
      { model: 'o3' },
    ]);
    getDefaultModel.mockReturnValue('gpt-4o');
    mockSavedSelection(undefined);

    const { req, res } = buildReqRes();
    // biome-ignore lint/suspicious/noExplicitAny: invoking the express handler with mocked req/res
    await getHandler()(req as any, res as any, vi.fn());

    const payload = res.apiv3.mock.calls[0][0];
    expect(payload.selectedModelId).toBe('gpt-4o');
  });
});
