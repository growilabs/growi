import { ConfigSource } from '@growi/core/dist/interfaces';

import type { AllowedModel } from '~/features/mastra/interfaces/allowed-model';

// Mock the config-manager and logger boundaries. The logger is the observable
// side effect of the malformed-config warn / env-shadowing info; config.ts routes
// those through the REAL warn-dedup registry (which shares this same mocked
// logger), so the dedup-on-repeat and clear-resets contracts are exercised end to
// end here rather than by asserting on internal collaboration.
const { getConfig, loggerWarn, loggerInfo } = vi.hoisted(() => ({
  getConfig: vi.fn(),
  loggerWarn: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig },
}));
vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: loggerWarn,
    info: loggerInfo,
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  getAllowedModels,
  getApiKey,
  getProviderSettings,
  requireApiKey,
} from './config';
import { clearAvailabilityLogDedup } from './warn-dedup';

type ConfigLayer = Partial<Record<string, unknown>>;

// Model configManager.getConfig(key, source?):
//   getConfig(key, ConfigSource.db)  -> the db layer value
//   getConfig(key, ConfigSource.env) -> the env layer value
//   getConfig(key)                   -> resolved: the env value for env-only keys,
//                                       else (db ?? env). The resolved result is
//                                       reference-identical to whichever layer won,
//                                       matching the real ConfigManager (config.ts
//                                       relies on that identity to detect shadowing).
const configureConfig = (opts: {
  db?: ConfigLayer;
  env?: ConfigLayer;
  envOnlyKeys?: readonly string[];
}): void => {
  const db = opts.db ?? {};
  const env = opts.env ?? {};
  const envOnly = new Set(opts.envOnlyKeys ?? []);
  getConfig.mockImplementation((key: string, source?: string) => {
    if (source === ConfigSource.db) return db[key];
    if (source === ConfigSource.env) return env[key];
    return envOnly.has(key) ? env[key] : (db[key] ?? env[key]);
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  clearAvailabilityLogDedup();
  configureConfig({});
});

describe('getProviderSettings', () => {
  it('returns the settings entry for the requested provider', () => {
    configureConfig({
      db: {
        'ai:providers': {
          openai: { enabled: true },
          'azure-openai': {
            enabled: false,
            azureOpenaiSettings: { resourceName: 'my-res' },
          },
        },
      },
    });

    expect(getProviderSettings('openai')).toEqual({ enabled: true });
    expect(getProviderSettings('azure-openai')).toEqual({
      enabled: false,
      azureOpenaiSettings: { resourceName: 'my-res' },
    });
  });

  it('returns undefined for a provider with no entry', () => {
    configureConfig({ db: { 'ai:providers': { openai: { enabled: true } } } });

    expect(getProviderSettings('google')).toBeUndefined();
  });

  it('returns undefined when ai:providers is unset, without warning', () => {
    configureConfig({});

    expect(getProviderSettings('openai')).toBeUndefined();
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('fails soft to undefined and warns exactly once for a malformed ai:providers, leaking no value', () => {
    // A hand-edited AI_PROVIDERS env var can be valid JSON that is not an object
    // (e.g. an array); it bypasses the PUT validator, so the accessor guards it.
    configureConfig({ env: { 'ai:providers': ['openai'] } });

    expect(getProviderSettings('openai')).toBeUndefined();
    // Repeat call across providers must not flood the log.
    expect(getProviderSettings('anthropic')).toBeUndefined();

    expect(loggerWarn).toHaveBeenCalledTimes(1);
    const warned = loggerWarn.mock.calls[0].join(' ');
    expect(warned).toContain('ai:providers');
    expect(warned).not.toContain('openai'); // config value never appears in the message
  });

  it('normalizes non-string azure connection fields to undefined instead of throwing (fail soft)', () => {
    // The loader casts env JSON unchecked, so a hand-edited AI_PROVIDERS can carry a
    // number where a string is declared. It must read as "unset" and never crash the
    // shared availability rule, which calls .trim() on these fields.
    configureConfig({
      env: {
        'ai:providers': {
          'azure-openai': {
            enabled: true,
            azureOpenaiSettings: { resourceName: 123, baseURL: 456 },
          },
        },
      },
    });

    const azure = getProviderSettings('azure-openai')?.azureOpenaiSettings;
    expect(azure?.resourceName).toBeUndefined();
    expect(azure?.baseURL).toBeUndefined();
  });

  it('normalizes blank / whitespace-only azure endpoint fields to undefined', () => {
    // '' / '   ' must read as absent so the resolver's `== null` endpoint guard
    // catches them; otherwise a blank baseURL reaches the SDK and builds an invalid URL.
    configureConfig({
      env: {
        'ai:providers': {
          'azure-openai': {
            enabled: true,
            azureOpenaiSettings: {
              resourceName: '   ',
              baseURL: '',
              apiVersion: '',
            },
          },
        },
      },
    });

    const azure = getProviderSettings('azure-openai')?.azureOpenaiSettings;
    expect(azure?.resourceName).toBeUndefined();
    expect(azure?.baseURL).toBeUndefined();
    expect(azure?.apiVersion).toBeUndefined();
  });

  it('drops a blank endpoint field while keeping a valid sibling (azure "available but Invalid URL" regression)', () => {
    // resourceName is valid but baseURL is '' from a hand-edited env var. baseURL
    // must become undefined so the resolver builds from resourceName instead of
    // forwarding '' to the SDK, which would treat '' as the endpoint and throw an
    // Invalid URL at request time even though availability reported "available".
    configureConfig({
      env: {
        'ai:providers': {
          'azure-openai': {
            enabled: true,
            azureOpenaiSettings: { resourceName: 'my-res', baseURL: '' },
          },
        },
      },
    });

    const azure = getProviderSettings('azure-openai')?.azureOpenaiSettings;
    expect(azure?.resourceName).toBe('my-res');
    expect(azure?.baseURL).toBeUndefined();
  });

  it('preserves valid azure connection fields verbatim', () => {
    configureConfig({
      env: {
        'ai:providers': {
          'azure-openai': {
            enabled: true,
            azureOpenaiSettings: {
              resourceName: 'my-res',
              apiVersion: '2024-10-01',
              useEntraId: true,
            },
          },
        },
      },
    });

    expect(getProviderSettings('azure-openai')?.azureOpenaiSettings).toEqual({
      resourceName: 'my-res',
      apiVersion: '2024-10-01',
      useEntraId: true,
    });
  });

  it('reads a non-boolean enabled flag as unset (disabled)', () => {
    configureConfig({
      env: { 'ai:providers': { openai: { enabled: 'true' } } },
    });

    expect(getProviderSettings('openai')?.enabled).toBeUndefined();
  });

  it('fails soft to undefined for a provider entry that is not an object', () => {
    configureConfig({ env: { 'ai:providers': { openai: 'not-an-object' } } });

    expect(getProviderSettings('openai')).toBeUndefined();
  });
});

describe('getApiKey', () => {
  it('returns the API key for the requested provider', () => {
    configureConfig({
      db: {
        'ai:providerApiKeys': {
          openai: 'sk-openai',
          anthropic: 'sk-anthropic',
        },
      },
    });

    expect(getApiKey('openai')).toBe('sk-openai');
    expect(getApiKey('anthropic')).toBe('sk-anthropic');
  });

  it('returns undefined for a provider with no stored key', () => {
    configureConfig({ db: { 'ai:providerApiKeys': { openai: 'sk-openai' } } });

    expect(getApiKey('google')).toBeUndefined();
  });

  it('returns undefined when ai:providerApiKeys is unset, without warning', () => {
    configureConfig({});

    expect(getApiKey('openai')).toBeUndefined();
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('reads a blank / whitespace-only / non-string key as unset (single blankness rule)', () => {
    // A hand-edited AI_PROVIDER_API_KEYS can carry '' / '   ' / a non-string; all
    // must read as "no usable key" so availability, isApiKeySet, and the resolvers
    // agree instead of exposing a provider whose every request 401s on a blank key.
    configureConfig({
      env: {
        'ai:providerApiKeys': {
          openai: '',
          anthropic: '   ',
          google: 123,
        },
      },
    });

    expect(getApiKey('openai')).toBeUndefined();
    expect(getApiKey('anthropic')).toBeUndefined();
    expect(getApiKey('google')).toBeUndefined();
  });

  it('fails soft and warns exactly once for a malformed ai:providerApiKeys without leaking key material', () => {
    // A malformed non-object value must never surface any key material in the warn.
    configureConfig({
      env: { 'ai:providerApiKeys': 'sk-leaked-string-not-an-object' },
    });

    expect(getApiKey('openai')).toBeUndefined();
    expect(getApiKey('anthropic')).toBeUndefined();

    expect(loggerWarn).toHaveBeenCalledTimes(1);
    const warned = loggerWarn.mock.calls[0].join(' ');
    expect(warned).toContain('ai:providerApiKeys');
    expect(warned).not.toContain('sk-leaked-string-not-an-object');
  });
});

describe('requireApiKey', () => {
  it('returns the key when present', () => {
    configureConfig({ db: { 'ai:providerApiKeys': { openai: 'sk-openai' } } });

    expect(requireApiKey('openai')).toBe('sk-openai');
  });

  it('throws naming the provider and the env var, but never any key value (1.9)', () => {
    configureConfig({
      db: { 'ai:providerApiKeys': { openai: 'sk-secret-openai-value' } },
    });

    let thrown: Error | undefined;
    try {
      requireApiKey('anthropic'); // a key exists for openai, but not for anthropic
    } catch (e) {
      thrown = e as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown?.message).toContain('anthropic');
    expect(thrown?.message).toContain('AI_PROVIDER_API_KEYS');
    // Must not leak any other provider's stored key value.
    expect(thrown?.message).not.toContain('sk-secret-openai-value');
  });
});

describe('getAllowedModels', () => {
  it('returns the configured allow-list as-is', () => {
    const models: AllowedModel[] = [
      { provider: 'openai', modelId: 'gpt-4o' },
      { provider: 'anthropic', modelId: 'claude-sonnet', isDefault: true },
    ];
    configureConfig({ db: { 'ai:allowedModels': models } });

    expect(getAllowedModels()).toEqual(models);
  });

  it('returns [] when the allow-list is unset (no synthesis / no migration), without warning', () => {
    configureConfig({});

    expect(getAllowedModels()).toEqual([]);
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('fails soft to [] and warns exactly once for a malformed (non-array) value', () => {
    // A hand-edited AI_ALLOWED_MODELS env var can be valid JSON that is not an
    // array (e.g. an object); it bypasses the PUT validator.
    configureConfig({ env: { 'ai:allowedModels': { 'gpt-4o': {} } } });

    expect(getAllowedModels()).toEqual([]);
    expect(getAllowedModels()).toEqual([]); // repeat -> still exactly one warn

    expect(loggerWarn).toHaveBeenCalledTimes(1);
    expect(loggerWarn.mock.calls[0].join(' ')).toContain('ai:allowedModels');
  });

  it('drops entries whose provider is missing / unsupported / non-object, keeping the valid ones', () => {
    // A hand-edited AI_ALLOWED_MODELS (or a pre-rename value) can carry entries with
    // no provider or an unknown provider; they bypass the PUT validator. Dropping
    // them here prevents an "invisible" form row (belongs to no provider panel) that
    // would 400 every admin save with no row the admin can see or delete.
    configureConfig({
      env: {
        'ai:allowedModels': [
          { provider: 'openai', modelId: 'gpt-4o', isDefault: true },
          { modelId: 'no-provider' }, // pre-rename entry, provider missing
          { provider: 'unknown-vendor', modelId: 'x' }, // unsupported provider
          'not-an-object',
          null,
          { provider: 'anthropic', modelId: 'claude-sonnet' },
        ],
      },
    });

    expect(getAllowedModels()).toEqual([
      { provider: 'openai', modelId: 'gpt-4o', isDefault: true },
      { provider: 'anthropic', modelId: 'claude-sonnet' },
    ]);
  });

  it('keeps a valid-provider entry with an empty modelId (visible + PUT-validator-caught, not silently dropped)', () => {
    // Only the provider drives panel visibility, so a valid-provider row is shown
    // and fixable; the empty modelId is the PUT validator's job, not this accessor's.
    configureConfig({
      env: {
        'ai:allowedModels': [{ provider: 'openai', modelId: '' }],
      },
    });

    expect(getAllowedModels()).toEqual([{ provider: 'openai', modelId: '' }]);
  });
});

describe('env/db shadowing observability', () => {
  it("emits a dedup'd info when both db and env define ai:providers (env shadowed by db), without the value", () => {
    configureConfig({
      db: { 'ai:providers': { openai: { enabled: true } } },
      env: { 'ai:providers': { anthropic: { enabled: true } } },
    });

    getProviderSettings('openai');
    getProviderSettings('anthropic'); // repeat -> still exactly one info

    expect(loggerInfo).toHaveBeenCalledTimes(1);
    const info = loggerInfo.mock.calls[0].join(' ');
    expect(info).toContain('ai:providers');
    // The value itself (provider names / settings) is never logged.
    expect(info).not.toContain('openai');
    expect(info).not.toContain('anthropic');
  });

  it('is silent when only the db value is defined', () => {
    configureConfig({ db: { 'ai:providers': { openai: { enabled: true } } } });

    getProviderSettings('openai');

    expect(loggerInfo).not.toHaveBeenCalled();
  });

  it('is silent when only the env value is defined', () => {
    configureConfig({ env: { 'ai:providers': { openai: { enabled: true } } } });

    getProviderSettings('openai');

    expect(loggerInfo).not.toHaveBeenCalled();
  });

  it('is silent for an env-only key even when both db and env are defined (env wins, nothing shadowed)', () => {
    configureConfig({
      db: { 'ai:providerApiKeys': { openai: 'sk-db' } },
      env: { 'ai:providerApiKeys': { openai: 'sk-env' } },
      envOnlyKeys: ['ai:providerApiKeys'],
    });

    getApiKey('openai');

    expect(loggerInfo).not.toHaveBeenCalled();
  });

  it('is silent when a DB allow-list coexists with the default empty-array env layer (env var not actually set)', () => {
    // In production the env layer is always populated with the key's default, so
    // ai:allowedModels reads back [] on the env side whenever AI_ALLOWED_MODELS is
    // unset. A normal admin-saved DB allow-list must NOT be reported as shadowing.
    configureConfig({
      db: { 'ai:allowedModels': [{ provider: 'openai', modelId: 'gpt-4o' }] },
      env: { 'ai:allowedModels': [] },
    });

    getAllowedModels();

    expect(loggerInfo).not.toHaveBeenCalled();
  });
});
