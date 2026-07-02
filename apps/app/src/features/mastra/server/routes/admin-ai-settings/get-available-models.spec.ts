// --- Mock boundary ---------------------------------------------------------
//
// getAvailableModels is a read handler over one collaborator:
//   - getSelectableModelIds(provider): the offline catalog lookup that returns
//     the bare model-id array for a provider ([] for a catalog-less provider).
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
const { getSelectableModelIds } = vi.hoisted(() => ({
  getSelectableModelIds: vi.fn(),
}));

vi.mock('../../services/ai-sdk-modules/model-catalog', () => ({
  getSelectableModelIds,
}));

import type { Request } from 'express';
import { mock } from 'vitest-mock-extended';

import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

import { getAvailableModels } from './get-available-models';

const invoke = (query: { provider?: string }) => {
  const req = mock<Request>({ query });
  const res = mock<ApiV3Response>();
  getAvailableModels(req, res);
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
  it('returns the catalog ids for a valid provider (Req 1.1)', () => {
    getSelectableModelIds.mockReturnValue(['gpt-4o']);

    const { res } = invoke({ provider: 'openai' });

    expect(getSelectableModelIds).toHaveBeenCalledExactlyOnceWith('openai');
    expect(responseBody(res)).toEqual({ modelIds: ['gpt-4o'] });
    expect(res.apiv3Err).not.toHaveBeenCalled();
  });

  it('returns { modelIds: [] } with 200 semantics for a valid but catalog-less provider (Req 3.1)', () => {
    // azure-openai is a valid provider absent from the catalog → getSelectableModelIds
    // yields [], which must surface as a 200 empty list, NOT an error.
    getSelectableModelIds.mockReturnValue([]);

    const { res } = invoke({ provider: 'azure-openai' });

    expect(getSelectableModelIds).toHaveBeenCalledExactlyOnceWith(
      'azure-openai',
    );
    expect(responseBody(res)).toEqual({ modelIds: [] });
    expect(res.apiv3Err).not.toHaveBeenCalled();
  });

  it('returns ONLY modelIds — no apiKey/providerOptions/credentials (Req 7.1)', () => {
    getSelectableModelIds.mockReturnValue(['gpt-4o', 'gpt-4o-mini']);

    const { res } = invoke({ provider: 'openai' });

    // The response contract is a single key. Asserting the exact key set catches
    // any accidental leak of a secret-bearing field into the wire response.
    expect(Object.keys(responseBody(res))).toEqual(['modelIds']);
  });
});
