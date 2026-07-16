import type { AzureOpenaiConfig } from '~/features/mastra/interfaces/azure-openai-config';

// Mock the @ai-sdk/azure + @azure/identity boundaries and the per-provider config
// accessors so the resolver is exercised deterministically (no real credential
// chain, no I/O). Azure connection settings now come from
// `getProviderSettings('azure-openai')?.azureOpenaiSettings` (env var AI_PROVIDERS)
// and the key from `getApiKey('azure-openai')` (env var AI_PROVIDER_API_KEYS) —
// both read for the azure-openai provider only. The deployment name (model) is the
// resolver argument, not read from config.
const {
  createAzure,
  azureProviderFn,
  DefaultAzureCredential,
  getBearerTokenProvider,
  tokenProviderSentinel,
  getApiKey,
  getProviderSettings,
} = vi.hoisted(() => {
  const azureProviderFn = vi.fn((modelId: string) => ({
    tag: 'azure-model',
    modelId,
  }));
  // Sentinel returned by the mocked getBearerTokenProvider so the Entra ID test
  // can assert it is forwarded to createAzure as `tokenProvider`.
  const tokenProviderSentinel = (): Promise<string> =>
    Promise.resolve('fake-token');
  return {
    azureProviderFn,
    tokenProviderSentinel,
    createAzure: vi.fn(
      (_opts: {
        apiKey?: string;
        tokenProvider?: () => Promise<string>;
        resourceName?: string;
        baseURL?: string;
        apiVersion?: string;
      }) => azureProviderFn,
    ),
    DefaultAzureCredential: vi.fn(),
    getBearerTokenProvider: vi.fn(() => tokenProviderSentinel),
    getApiKey: vi.fn(),
    getProviderSettings: vi.fn(),
  };
});

vi.mock('@ai-sdk/azure', () => ({ createAzure }));
vi.mock('@azure/identity', () => ({
  DefaultAzureCredential,
  getBearerTokenProvider,
}));
vi.mock('./config', () => ({ getApiKey, getProviderSettings }));

import { resolveAzureOpenaiModel } from './azure-openai';

// Set the azure-openai provider's stored key and connection settings. Both
// accessors are provider-scoped, so they return their value only for
// 'azure-openai' and undefined otherwise (proving the resolver reads its own
// provider entry).
const setAzureConfig = (opts: {
  apiKey?: string;
  azureOpenaiSettings?: AzureOpenaiConfig;
}): void => {
  getApiKey.mockImplementation((provider: string) =>
    provider === 'azure-openai' ? opts.apiKey : undefined,
  );
  getProviderSettings.mockImplementation((provider: string) =>
    provider === 'azure-openai'
      ? { enabled: true, azureOpenaiSettings: opts.azureOpenaiSettings }
      : undefined,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveAzureOpenaiModel', () => {
  it("reads its own provider's key + settings and applies the model argument as the deployment name", async () => {
    setAzureConfig({
      apiKey: 'az-key',
      azureOpenaiSettings: { resourceName: 'my-resource' },
    });

    const result = await resolveAzureOpenaiModel('my-deployment');

    expect(getProviderSettings).toHaveBeenCalledWith('azure-openai');
    expect(getApiKey).toHaveBeenCalledWith('azure-openai');
    expect(createAzure).toHaveBeenCalledWith({
      apiKey: 'az-key',
      resourceName: 'my-resource',
    });
    expect(azureProviderFn).toHaveBeenCalledWith('my-deployment');
    expect(result).toEqual({ tag: 'azure-model', modelId: 'my-deployment' });
  });

  it('builds with baseURL when given', async () => {
    setAzureConfig({
      apiKey: 'az-key',
      azureOpenaiSettings: {
        baseURL: 'https://gw.example.com/openai/deployments',
      },
    });

    await resolveAzureOpenaiModel('dep');

    expect(createAzure).toHaveBeenCalledWith({
      apiKey: 'az-key',
      baseURL: 'https://gw.example.com/openai/deployments',
    });
  });

  it('forwards both resourceName and baseURL when both are set (AI SDK ignores resourceName)', async () => {
    setAzureConfig({
      apiKey: 'az-key',
      azureOpenaiSettings: {
        resourceName: 'res-ignored-by-sdk',
        baseURL: 'https://gw.example.com',
      },
    });

    await resolveAzureOpenaiModel('dep');

    // Both are passed straight through; the AI SDK is responsible for ignoring
    // resourceName when baseURL is present, so the resolver no longer pre-selects.
    expect(createAzure).toHaveBeenCalledWith({
      apiKey: 'az-key',
      resourceName: 'res-ignored-by-sdk',
      baseURL: 'https://gw.example.com',
    });
  });

  it('forwards apiVersion only when set', async () => {
    setAzureConfig({
      apiKey: 'az-key',
      azureOpenaiSettings: {
        resourceName: 'res',
        apiVersion: '2024-10-01-preview',
      },
    });

    await resolveAzureOpenaiModel('dep');

    expect(createAzure).toHaveBeenCalledWith({
      apiKey: 'az-key',
      resourceName: 'res',
      apiVersion: '2024-10-01-preview',
    });
  });

  it('authenticates via Microsoft Entra ID (tokenProvider) instead of an apiKey when useEntraId is set', async () => {
    setAzureConfig({
      // no api key in Entra ID mode
      azureOpenaiSettings: {
        resourceName: 'my-resource',
        useEntraId: true,
      },
    });

    const result = await resolveAzureOpenaiModel('my-deployment');

    expect(getBearerTokenProvider).toHaveBeenCalledWith(
      expect.anything(),
      'https://cognitiveservices.azure.com/.default',
    );
    // The token provider — not an apiKey — is forwarded to the SDK.
    expect(createAzure).toHaveBeenCalledWith({
      resourceName: 'my-resource',
      tokenProvider: tokenProviderSentinel,
    });
    expect(createAzure).not.toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: expect.anything() }),
    );
    // The Entra ID path never consults the API key accessor.
    expect(getApiKey).not.toHaveBeenCalled();
    expect(result).toEqual({ tag: 'azure-model', modelId: 'my-deployment' });
  });

  it('rejects (naming the missing endpoint fields / AI_PROVIDERS, never the key) when neither resourceName nor baseURL is set', async () => {
    const secret = 'az-super-secret';
    setAzureConfig({ apiKey: secret });

    // Endpoint validation runs before any dynamic import, so this rejects without
    // loading @ai-sdk/azure (createAzure, its exported creator, is untouched).
    await expect(resolveAzureOpenaiModel('dep')).rejects.toThrow(
      /resourceName|baseURL|AI_PROVIDERS/,
    );
    expect(createAzure).not.toHaveBeenCalled();

    const err = await resolveAzureOpenaiModel('dep').catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(secret);
  });

  it('rejects (naming AI_PROVIDER_API_KEYS / useEntraId) when neither an apiKey nor Entra ID is configured (endpoint present)', async () => {
    setAzureConfig({
      azureOpenaiSettings: { resourceName: 'my-resource' },
    });

    await expect(resolveAzureOpenaiModel('dep')).rejects.toThrow(
      /AI_PROVIDER_API_KEYS|useEntraId/,
    );
    expect(createAzure).not.toHaveBeenCalled();
  });
});
