import type { ConfigKey } from '~/server/service/config-manager/config-definition';

// Mock the @ai-sdk/azure + @azure/identity boundaries and config-manager so the
// resolver is exercised deterministically (no real credential chain, no I/O).
const {
  createAzure,
  azureProviderFn,
  DefaultAzureCredential,
  getBearerTokenProvider,
  tokenProviderSentinel,
  getConfig,
} = vi.hoisted(() => {
  const azureProviderFn = vi.fn((model: string) => ({
    tag: 'azure-model',
    model,
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
    getConfig: vi.fn(),
  };
});

vi.mock('@ai-sdk/azure', () => ({ createAzure }));
vi.mock('@azure/identity', () => ({
  DefaultAzureCredential,
  getBearerTokenProvider,
}));
vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig },
}));

import { resolveAzureOpenaiModel } from './azure-openai';

type ConfigFixture = Partial<Record<ConfigKey, string | boolean | undefined>>;

const applyConfig = (fixture: ConfigFixture): void => {
  getConfig.mockImplementation((key: ConfigKey) =>
    key in fixture ? fixture[key] : undefined,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveAzureOpenaiModel', () => {
  it('builds with resourceName and applies the deployment name as the model', () => {
    applyConfig({
      'ai:apiKey': 'az-key',
      'ai:model': 'my-deployment',
      'ai:azureOpenaiResourceName': 'my-resource',
    });

    const result = resolveAzureOpenaiModel();

    expect(createAzure).toHaveBeenCalledWith({
      apiKey: 'az-key',
      resourceName: 'my-resource',
    });
    expect(azureProviderFn).toHaveBeenCalledWith('my-deployment');
    expect(result).toEqual({ tag: 'azure-model', model: 'my-deployment' });
  });

  it('builds with baseURL when given', () => {
    applyConfig({
      'ai:apiKey': 'az-key',
      'ai:model': 'dep',
      'ai:azureOpenaiBaseUrl': 'https://gw.example.com/openai/deployments',
    });

    resolveAzureOpenaiModel();

    expect(createAzure).toHaveBeenCalledWith({
      apiKey: 'az-key',
      baseURL: 'https://gw.example.com/openai/deployments',
    });
  });

  it('forwards both resourceName and baseURL when both are set (AI SDK ignores resourceName)', () => {
    applyConfig({
      'ai:apiKey': 'az-key',
      'ai:model': 'dep',
      'ai:azureOpenaiResourceName': 'res-ignored-by-sdk',
      'ai:azureOpenaiBaseUrl': 'https://gw.example.com',
    });

    resolveAzureOpenaiModel();

    // Both are passed straight through; the AI SDK is responsible for ignoring
    // resourceName when baseURL is present, so the resolver no longer pre-selects.
    expect(createAzure).toHaveBeenCalledWith({
      apiKey: 'az-key',
      resourceName: 'res-ignored-by-sdk',
      baseURL: 'https://gw.example.com',
    });
  });

  it('forwards apiVersion only when set', () => {
    applyConfig({
      'ai:apiKey': 'az-key',
      'ai:model': 'dep',
      'ai:azureOpenaiResourceName': 'res',
      'ai:azureOpenaiApiVersion': '2024-10-01-preview',
    });

    resolveAzureOpenaiModel();

    expect(createAzure).toHaveBeenCalledWith({
      apiKey: 'az-key',
      resourceName: 'res',
      apiVersion: '2024-10-01-preview',
    });
  });

  it('authenticates via Microsoft Entra ID (tokenProvider) instead of an apiKey when useEntraId is set', () => {
    applyConfig({
      // no ai:apiKey in Entra ID mode
      'ai:model': 'my-deployment',
      'ai:azureOpenaiResourceName': 'my-resource',
      'ai:azureOpenaiUseEntraId': true,
    });

    const result = resolveAzureOpenaiModel();

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
    expect(result).toEqual({ tag: 'azure-model', model: 'my-deployment' });
  });

  it('throws (naming the endpoint env vars, never the key) when neither resourceName nor baseURL is set', () => {
    const secret = 'az-super-secret';
    applyConfig({ 'ai:apiKey': secret, 'ai:model': 'dep' });

    expect(() => resolveAzureOpenaiModel()).toThrow(
      /AI_AZURE_OPENAI_RESOURCE_NAME|AI_AZURE_OPENAI_BASE_URL/,
    );
    expect(createAzure).not.toHaveBeenCalled();

    try {
      resolveAzureOpenaiModel();
    } catch (e) {
      expect((e as Error).message).not.toContain(secret);
    }
  });

  it('throws when neither an apiKey nor Entra ID is configured (endpoint present)', () => {
    applyConfig({
      'ai:model': 'dep',
      'ai:azureOpenaiResourceName': 'my-resource',
    });

    expect(() => resolveAzureOpenaiModel()).toThrow(
      /AI_API_KEY|AI_AZURE_OPENAI_USE_ENTRA_ID/,
    );
    expect(createAzure).not.toHaveBeenCalled();
  });
});
