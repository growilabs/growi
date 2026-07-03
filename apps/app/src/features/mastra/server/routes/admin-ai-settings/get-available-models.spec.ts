// --- Mock boundary ---------------------------------------------------------
//
// getAvailableModels is a read handler over one collaborator:
//   - getEffectiveSelectableModelIds(provider): the local catalog lookup
//     (persisted refreshed catalog ?? bundled asset — Req 9.5) that returns the
//     bare model-id array for a provider ([] for a catalog-less provider).
// Provider validation now lives in the middleware chain (getAvailableModelsValidators
// + apiV3FormValidator), NOT in the handler, so the handler trusts `provider` and
// this unit test asserts only its map-to-response contract:
//   - a valid provider → res.apiv3({ modelIds }) with the looked-up ids (1.1, 3.1)
//   - a catalog-less-but-valid provider (azure-openai) → 200 { modelIds: [] } (3.1)
//   - the response object carries ONLY `modelIds` — never a secret (Req 7.1)
// The invalid/missing-provider → 400 path (validators + apiV3FormValidator) is
// exercised end-to-end against the real middleware chain in index.spec.ts.
// We mock the catalog collaborator so the test exercises only this handler's
// map logic, not how the catalog is resolved.
const { getEffectiveSelectableModelIds } = vi.hoisted(() => ({
  getEffectiveSelectableModelIds: vi.fn(),
}));

vi.mock('../../services/ai-sdk-modules/effective-model-catalog', () => ({
  getEffectiveSelectableModelIds,
}));

import { mock } from 'vitest-mock-extended';

import type { AiProvider } from '~/features/mastra/interfaces/ai-provider';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

import {
  type GetAvailableModelsRequest,
  getAvailableModels,
} from './get-available-models';

// The handler trusts a validated provider (GetAvailableModelsRequest), so the
// unit test supplies AiProvider values directly.
const invoke = async (query: { provider: AiProvider }) => {
  const req = mock<GetAvailableModelsRequest>({ query });
  const res = mock<ApiV3Response>();
  await getAvailableModels(req, res);
  return { res };
};

// Pull the single object the handler handed to res.apiv3().
const responseBody = (res: ApiV3Response): Record<string, unknown> => {
  const apiv3 = vi.mocked(res.apiv3);
  expect(apiv3).toHaveBeenCalledTimes(1);
  return apiv3.mock.calls[0][0] as Record<string, unknown>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getAvailableModels (Req 1.1, 3.1, 7.1)', () => {
  it('returns the catalog ids for a valid provider (Req 1.1)', async () => {
    getEffectiveSelectableModelIds.mockResolvedValue(['gpt-4o']);

    const { res } = await invoke({ provider: 'openai' });

    expect(getEffectiveSelectableModelIds).toHaveBeenCalledExactlyOnceWith(
      'openai',
    );
    expect(responseBody(res)).toEqual({ modelIds: ['gpt-4o'] });
    expect(res.apiv3Err).not.toHaveBeenCalled();
  });

  it('returns { modelIds: [] } with 200 semantics for a valid but catalog-less provider (Req 3.1)', async () => {
    // azure-openai is a valid provider absent from the catalog → the effective
    // lookup yields [], which must surface as a 200 empty list, NOT an error.
    getEffectiveSelectableModelIds.mockResolvedValue([]);

    const { res } = await invoke({ provider: 'azure-openai' });

    expect(getEffectiveSelectableModelIds).toHaveBeenCalledExactlyOnceWith(
      'azure-openai',
    );
    expect(responseBody(res)).toEqual({ modelIds: [] });
    expect(res.apiv3Err).not.toHaveBeenCalled();
  });

  it('returns ONLY modelIds — no apiKey/providerOptions/credentials (Req 7.1)', async () => {
    getEffectiveSelectableModelIds.mockResolvedValue(['gpt-4o', 'gpt-4o-mini']);

    const { res } = await invoke({ provider: 'openai' });

    // The response contract is a single key. Asserting the exact key set catches
    // any accidental leak of a secret-bearing field into the wire response.
    expect(Object.keys(responseBody(res))).toEqual(['modelIds']);
  });

  it('responds with a generic 500 when the catalog read fails (no internal leak)', async () => {
    getEffectiveSelectableModelIds.mockRejectedValue(
      new Error('boom: mongo down at 10.0.0.1'),
    );

    const { res } = await invoke({ provider: 'openai' });

    expect(res.apiv3).not.toHaveBeenCalled();
    const apiv3Err = vi.mocked(res.apiv3Err);
    expect(apiv3Err).toHaveBeenCalledTimes(1);
    const [errArg, status] = apiv3Err.mock.calls[0];
    expect(status).toBe(500);
    const message =
      typeof errArg === 'string'
        ? errArg
        : String((errArg as { message?: unknown })?.message ?? '');
    expect(message).not.toContain('10.0.0.1');
  });
});
