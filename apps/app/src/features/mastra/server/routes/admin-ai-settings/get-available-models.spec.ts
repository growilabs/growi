// --- Mock boundary ---------------------------------------------------------
//
// getAvailableModels is a read handler over one collaborator:
//   - getSelectableModelIds(provider): the offline catalog lookup that returns
//     the bare model-id array for a provider ([] for a catalog-less provider).
// The observable contract is what the handler hands to res.apiv3 / res.apiv3Err:
//   - a valid provider → res.apiv3({ modelIds }) with the looked-up ids (1.1, 3.1)
//   - a catalog-less-but-valid provider (azure-openai) → 200 { modelIds: [] } (3.1)
//   - an invalid / missing provider → apiv3Err with a 400 code, and the catalog is
//     NOT consulted (input validation)
//   - the response object carries ONLY `modelIds` — never a secret (Req 7.1)
// We mock the catalog collaborator so the test exercises only this handler's
// validate-then-map logic, not how the catalog is resolved.
const { getSelectableModelIds } = vi.hoisted(() => ({
  getSelectableModelIds: vi.fn(),
}));

vi.mock('../../services/ai-sdk-modules/model-catalog', () => ({
  getSelectableModelIds,
}));

import type { Request } from 'express';
import type { ParsedQs } from 'qs';
import { mock } from 'vitest-mock-extended';

import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

import { getAvailableModels } from './get-available-models';

const invoke = (query: ParsedQs) => {
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

// The 400 code the handler must pass to res.apiv3Err for an invalid provider.
const errStatus = (res: ApiV3Response): unknown => {
  const apiv3Err = vi.mocked(res.apiv3Err);
  expect(apiv3Err).toHaveBeenCalledTimes(1);
  return apiv3Err.mock.calls[0][1];
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

  it('rejects an invalid provider with 400 and never consults the catalog', () => {
    const { res } = invoke({ provider: 'bogus' });

    expect(errStatus(res)).toBe(400);
    expect(res.apiv3).not.toHaveBeenCalled();
    expect(getSelectableModelIds).not.toHaveBeenCalled();
  });

  it('rejects a missing provider with 400 (isAiProvider(undefined) is false)', () => {
    const { res } = invoke({});

    expect(errStatus(res)).toBe(400);
    expect(res.apiv3).not.toHaveBeenCalled();
    expect(getSelectableModelIds).not.toHaveBeenCalled();
  });

  it('returns ONLY modelIds — no apiKey/providerOptions/credentials (Req 7.1)', () => {
    getSelectableModelIds.mockReturnValue(['gpt-4o', 'gpt-4o-mini']);

    const { res } = invoke({ provider: 'openai' });

    // The response contract is a single key. Asserting the exact key set catches
    // any accidental leak of a secret-bearing field into the wire response.
    expect(Object.keys(responseBody(res))).toEqual(['modelIds']);
  });
});
