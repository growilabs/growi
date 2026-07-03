import type { AiProvider } from '~/features/mastra/interfaces/ai-provider';
import type { AllowedModel } from '~/features/mastra/interfaces/allowed-model';
import type { AiProviderSettings } from '~/features/mastra/interfaces/provider-settings';

// provider-availability is the single availability predicate. It depends only on
// the config accessors (mocked here so each matrix cell is driven deterministically)
// and the REAL warn-dedup registry. warn-dedup's only observable side effect is what
// it forwards to the logger, so we mock the logger boundary and exercise the
// dedup-once / reset-refires contract end to end (rather than spying on internals).
const { getProviderSettings, getApiKey, getAllowedModels, loggerWarn } =
  vi.hoisted(() => ({
    getProviderSettings: vi.fn(),
    getApiKey: vi.fn(),
    getAllowedModels: vi.fn(),
    loggerWarn: vi.fn(),
  }));

vi.mock('./config', () => ({
  getProviderSettings,
  getApiKey,
  getAllowedModels,
}));
vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: loggerWarn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  clearAvailabilityLogDedup,
  getAvailableModels,
  getAvailableProviders,
  getProviderAvailability,
} from './provider-availability';

const configure = (opts: {
  providers?: Partial<Record<AiProvider, AiProviderSettings>>;
  apiKeys?: Partial<Record<AiProvider, string>>;
  allowedModels?: AllowedModel[];
}): void => {
  getProviderSettings.mockImplementation(
    (p: AiProvider) => opts.providers?.[p],
  );
  getApiKey.mockImplementation((p: AiProvider) => opts.apiKeys?.[p]);
  getAllowedModels.mockReturnValue(opts.allowedModels ?? []);
};

beforeEach(() => {
  vi.clearAllMocks();
  clearAvailabilityLogDedup();
  configure({});
});

describe('getProviderAvailability - disabled (Req 1.6)', () => {
  it('is unavailable with reason "disabled" when the provider has no entry', () => {
    configure({});

    expect(getProviderAvailability('openai')).toEqual({
      available: false,
      reason: 'disabled',
    });
  });

  it('is unavailable with reason "disabled" when enabled is explicitly false', () => {
    configure({ providers: { openai: { enabled: false } } });

    expect(getProviderAvailability('openai')).toEqual({
      available: false,
      reason: 'disabled',
    });
  });

  it('is unavailable with reason "disabled" when enabled is omitted, even if a key is set', () => {
    configure({ providers: { openai: {} }, apiKeys: { openai: 'sk-openai' } });

    expect(getProviderAvailability('openai')).toEqual({
      available: false,
      reason: 'disabled',
    });
  });

  it('does NOT warn for a disabled provider (admin intent, not a misconfiguration)', () => {
    configure({ providers: { openai: { enabled: false } } });

    getProviderAvailability('openai');

    expect(loggerWarn).not.toHaveBeenCalled();
  });
});

describe('getProviderAvailability - key-based providers (Req 1.7, 6.1)', () => {
  it.each([
    'openai',
    'anthropic',
    'google',
  ] as const)('is available when %s is enabled and has an API key', (provider) => {
    configure({
      providers: { [provider]: { enabled: true } },
      apiKeys: { [provider]: 'sk-value' },
    });

    expect(getProviderAvailability(provider)).toEqual({ available: true });
  });

  it.each([
    'openai',
    'anthropic',
    'google',
  ] as const)('is unavailable with reason "missing-api-key" when %s is enabled without a key', (provider) => {
    configure({ providers: { [provider]: { enabled: true } } });

    expect(getProviderAvailability(provider)).toEqual({
      available: false,
      reason: 'missing-api-key',
    });
  });
});

describe('getProviderAvailability - azure-openai (Req 1.10, 6.1)', () => {
  const enabledAzure = (
    settings: AiProviderSettings['azureOpenaiSettings'],
  ) => ({
    providers: {
      'azure-openai': { enabled: true, azureOpenaiSettings: settings },
    },
  });

  it('is available with resourceName + API key', () => {
    configure({
      ...enabledAzure({ resourceName: 'my-res' }),
      apiKeys: { 'azure-openai': 'sk-azure' },
    });

    expect(getProviderAvailability('azure-openai')).toEqual({
      available: true,
    });
  });

  it('is available with baseURL + API key', () => {
    configure({
      ...enabledAzure({ baseURL: 'https://example.openai.azure.com' }),
      apiKeys: { 'azure-openai': 'sk-azure' },
    });

    expect(getProviderAvailability('azure-openai')).toEqual({
      available: true,
    });
  });

  it('is available with an endpoint and useEntraId (API key waived)', () => {
    configure(enabledAzure({ resourceName: 'my-res', useEntraId: true }));

    expect(getProviderAvailability('azure-openai')).toEqual({
      available: true,
    });
  });

  it('is unavailable with reason "missing-azure-endpoint" when neither resourceName nor baseURL is set', () => {
    configure({
      ...enabledAzure({}),
      apiKeys: { 'azure-openai': 'sk-azure' },
    });

    expect(getProviderAvailability('azure-openai')).toEqual({
      available: false,
      reason: 'missing-azure-endpoint',
    });
  });

  it('reports missing-azure-endpoint (endpoint precedence) even when the key is also absent', () => {
    configure(enabledAzure({ useEntraId: false }));

    expect(getProviderAvailability('azure-openai')).toEqual({
      available: false,
      reason: 'missing-azure-endpoint',
    });
  });

  it('is unavailable with reason "missing-api-key" when an endpoint is set but the key is missing and Entra ID is off', () => {
    configure(enabledAzure({ resourceName: 'my-res' }));

    expect(getProviderAvailability('azure-openai')).toEqual({
      available: false,
      reason: 'missing-api-key',
    });
  });

  it('requires the key when useEntraId is explicitly false', () => {
    configure(enabledAzure({ baseURL: 'https://x', useEntraId: false }));

    expect(getProviderAvailability('azure-openai')).toEqual({
      available: false,
      reason: 'missing-api-key',
    });
  });
});

describe('getProviderAvailability - misconfiguration warn (Req 6.1, 1.9)', () => {
  it('warns once per (provider, reason) and does not flood on repeat calls', () => {
    configure({ providers: { openai: { enabled: true } } });

    getProviderAvailability('openai');
    getProviderAvailability('openai');
    getProviderAvailability('openai');

    expect(loggerWarn).toHaveBeenCalledTimes(1);
    const warned = loggerWarn.mock.calls[0].join(' ');
    expect(warned).toContain('openai');
    expect(warned).toContain('missing-api-key');
  });

  it('warns independently for distinct (provider, reason) tuples', () => {
    configure({
      providers: {
        openai: { enabled: true },
        'azure-openai': { enabled: true, azureOpenaiSettings: {} },
      },
      apiKeys: { 'azure-openai': 'sk-azure' },
    });

    getProviderAvailability('openai'); // missing-api-key
    getProviderAvailability('azure-openai'); // missing-azure-endpoint

    expect(loggerWarn).toHaveBeenCalledTimes(2);
  });

  it('never includes any API key value in the warn message', () => {
    // Azure has a key but no endpoint -> missing-azure-endpoint. A naive impl that
    // dumps the settings/key would leak; the message must carry provider + reason only.
    configure({
      providers: {
        'azure-openai': { enabled: true, azureOpenaiSettings: {} },
      },
      apiKeys: { 'azure-openai': 'sk-secret-azure-value' },
    });

    getProviderAvailability('azure-openai');

    const warned = loggerWarn.mock.calls[0].join(' ');
    expect(warned).toContain('azure-openai');
    expect(warned).toContain('missing-azure-endpoint');
    expect(warned).not.toContain('sk-secret-azure-value');
  });

  it('re-fires the warn after clearAvailabilityLogDedup() (config change re-notifies)', () => {
    configure({ providers: { openai: { enabled: true } } });

    getProviderAvailability('openai');
    getProviderAvailability('openai');
    expect(loggerWarn).toHaveBeenCalledTimes(1);

    clearAvailabilityLogDedup();

    getProviderAvailability('openai');
    expect(loggerWarn).toHaveBeenCalledTimes(2);
  });
});

describe('getAvailableProviders (Req 6.1)', () => {
  it('returns only enabled and configured providers', () => {
    configure({
      providers: {
        openai: { enabled: true },
        anthropic: { enabled: true }, // enabled but no key -> excluded
        google: { enabled: false }, // disabled -> excluded
        'azure-openai': {
          enabled: true,
          azureOpenaiSettings: { resourceName: 'r', useEntraId: true },
        },
      },
      apiKeys: { openai: 'sk-openai' },
    });

    expect(getAvailableProviders()).toEqual(['openai', 'azure-openai']);
  });

  it('returns an empty array on fully-unset config (no throw, no precondition)', () => {
    configure({});

    expect(getAvailableProviders()).toEqual([]);
  });
});

describe('getAvailableModels (Req 6.1)', () => {
  it('excludes models whose owning provider is unavailable and is a subset of the allow-list', () => {
    const allowedModels: AllowedModel[] = [
      { provider: 'openai', modelId: 'gpt-5', isDefault: true },
      { provider: 'anthropic', modelId: 'claude-sonnet-5' }, // provider misconfigured
      { provider: 'google', modelId: 'gemini' }, // provider disabled
    ];
    configure({
      providers: {
        openai: { enabled: true },
        anthropic: { enabled: true }, // no key -> unavailable
        google: { enabled: false },
      },
      apiKeys: { openai: 'sk-openai' },
      allowedModels,
    });

    const result = getAvailableModels();

    expect(result).toEqual([
      { provider: 'openai', modelId: 'gpt-5', isDefault: true },
    ]);
    // Subset property: every available model is in the allow-list.
    expect(allowedModels).toEqual(expect.arrayContaining(result));
  });

  it('returns an empty array (no throw) when nothing is configured', () => {
    configure({ allowedModels: [] });

    expect(getAvailableModels()).toEqual([]);
  });

  it('keeps allow-list order for available models', () => {
    const allowedModels: AllowedModel[] = [
      { provider: 'anthropic', modelId: 'claude' },
      { provider: 'openai', modelId: 'gpt-5' },
      { provider: 'anthropic', modelId: 'claude-2' },
    ];
    configure({
      providers: {
        openai: { enabled: true },
        anthropic: { enabled: true },
      },
      apiKeys: { openai: 'sk-openai', anthropic: 'sk-anthropic' },
      allowedModels,
    });

    expect(getAvailableModels()).toEqual(allowedModels);
  });
});
