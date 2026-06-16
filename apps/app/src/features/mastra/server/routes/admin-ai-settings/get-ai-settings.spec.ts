// --- Mock boundary ---------------------------------------------------------
//
// getAiSettings is a read handler over two collaborators:
//   - configManager.getConfig(key): the currently effective value of each AI
//     config key (already honors env-only mode internally).
//   - isAiConfigured(): provider + required-field validity used for the 7.6
//     "enabled but not configured" warning.
// The observable contract is the SHAPE of the response object passed to
// res.apiv3():
//   - the ai:apiKey VALUE is never present; only isApiKeySet (Req 5.2)
//   - isApiKeySet reflects whether ai:apiKey is non-empty
//   - useOnlyEnvVars / aiEnabled / isConfigured reflect their sources (Req 4.2, 7.1, 7.6)
//   - provider / model / providerOptions / azure fields pass through (Req 1.4)
//   - on a collaborator failure the handler answers apiv3Err WITHOUT leaking the key (Req 5.3)
// We mock both collaborators so the test exercises only this handler's mapping,
// not how a value is resolved or how "configured" is computed.
const { getConfig } = vi.hoisted(() => ({
  getConfig: vi.fn(),
}));
const { isAiConfigured } = vi.hoisted(() => ({
  isAiConfigured: vi.fn(),
}));

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig },
}));

vi.mock('~/features/mastra/server/services/is-ai-configured', () => ({
  isAiConfigured,
}));

import type { Request } from 'express';
import { mock } from 'vitest-mock-extended';

import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

import { getAiSettings } from './get-ai-settings';

// The full set of stored values the handler reads, keyed by config key. Tests
// override only the fields they assert on; everything else stays at this baseline.
type ConfigStub = Record<string, unknown>;

const setConfig = (overrides: ConfigStub = {}): void => {
  const base: ConfigStub = {
    'app:aiEnabled': false,
    'ai:provider': undefined,
    'ai:apiKey': undefined,
    'ai:model': undefined,
    'ai:providerOptions': undefined,
    // Azure connection config is one JSON object, exposed as-is under
    // azureOpenaiSettings in the response.
    'ai:azureOpenaiSettings': {},
    'env:useOnlyEnvVars:ai': false,
    ...overrides,
  };
  getConfig.mockImplementation((key: string) => base[key]);
};

const invoke = () => {
  const req = mock<Request>();
  const res = mock<ApiV3Response>();
  getAiSettings(req, res);
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
  isAiConfigured.mockReturnValue(false);
  setConfig();
});

describe('getAiSettings (Req 1.4, 4.2, 5.2, 5.3, 7.1, 7.6)', () => {
  it('never exposes the ai:apiKey value, surfacing only isApiKeySet (Req 5.2)', () => {
    setConfig({ 'ai:apiKey': 'sk-super-secret-value' });

    const { res } = invoke();

    const body = responseBody(res);
    expect(body.isApiKeySet).toBe(true);
    // The actual secret must not appear under any field of the response.
    expect(JSON.stringify(body)).not.toContain('sk-super-secret-value');
    expect(body).not.toHaveProperty('apiKey');
  });

  it('reports isApiKeySet=false when ai:apiKey is unset (Req 5.2)', () => {
    setConfig({ 'ai:apiKey': undefined });

    const { res } = invoke();

    expect(responseBody(res).isApiKeySet).toBe(false);
  });

  it('reports isApiKeySet=false when ai:apiKey is an empty string (Req 5.2)', () => {
    setConfig({ 'ai:apiKey': '' });

    const { res } = invoke();

    expect(responseBody(res).isApiKeySet).toBe(false);
  });

  it('returns aiEnabled from app:aiEnabled (Req 7.1)', () => {
    setConfig({ 'app:aiEnabled': true });

    const { res } = invoke();

    expect(responseBody(res).aiEnabled).toBe(true);
  });

  it('returns useOnlyEnvVars from env:useOnlyEnvVars:ai (Req 4.2)', () => {
    setConfig({ 'env:useOnlyEnvVars:ai': true });

    const { res } = invoke();

    expect(responseBody(res).useOnlyEnvVars).toBe(true);
  });

  it('returns useOnlyEnvVars=false when env:useOnlyEnvVars:ai is not enabled (Req 4.2)', () => {
    setConfig({ 'env:useOnlyEnvVars:ai': false });

    const { res } = invoke();

    expect(responseBody(res).useOnlyEnvVars).toBe(false);
  });

  it('returns isConfigured from isAiConfigured() (Req 7.6)', () => {
    isAiConfigured.mockReturnValue(true);

    const { res } = invoke();

    expect(responseBody(res).isConfigured).toBe(true);
    expect(isAiConfigured).toHaveBeenCalledTimes(1);
  });

  it('passes through the non-secret effective values (Req 1.4)', () => {
    setConfig({
      'ai:provider': 'azure-openai',
      'ai:model': 'gpt-4o',
      'ai:providerOptions': '{"openai":{"temperature":0.2}}',
      'ai:azureOpenaiSettings': {
        resourceName: 'my-resource',
        baseURL: 'https://example.openai.azure.com',
        apiVersion: '2024-02-01',
        useEntraId: true,
      },
    });

    const { res } = invoke();

    // The stored ai:azureOpenaiSettings object is exposed as-is under
    // azureOpenaiSettings (one canonical type end-to-end, Req 1.4).
    expect(responseBody(res)).toMatchObject({
      provider: 'azure-openai',
      model: 'gpt-4o',
      providerOptions: '{"openai":{"temperature":0.2}}',
      azureOpenaiSettings: {
        resourceName: 'my-resource',
        baseURL: 'https://example.openai.azure.com',
        apiVersion: '2024-02-01',
        useEntraId: true,
      },
    });
  });

  it('passes the azureOpenaiSettings object through verbatim (no normalization)', () => {
    setConfig({ 'ai:azureOpenaiSettings': { resourceName: 'my-resource' } });

    const { res } = invoke();

    // The handler does not fill defaults; useEntraId is simply absent here (the
    // form applies the `?? false` default when seeding its inputs).
    expect(responseBody(res).azureOpenaiSettings).toEqual({
      resourceName: 'my-resource',
    });
  });

  it('responds with apiv3Err and does not leak the apiKey when a collaborator throws (Req 5.3)', () => {
    setConfig({ 'ai:apiKey': 'sk-leak-me-not' });
    isAiConfigured.mockImplementation(() => {
      throw new Error('boom while computing configured state');
    });

    const { res } = invoke();

    const apiv3Err = vi.mocked(res.apiv3Err);
    expect(apiv3Err).toHaveBeenCalledTimes(1);
    expect(res.apiv3).not.toHaveBeenCalled();
    const errArg = apiv3Err.mock.calls[0][0];
    const message =
      typeof errArg === 'string'
        ? errArg
        : String((errArg as { message?: unknown })?.message ?? '');
    expect(message).not.toContain('sk-leak-me-not');
  });
});
