// --- Mock boundary ---------------------------------------------------------
//
// getAiSettings is a read handler that assembles the multi-provider AI settings
// for the admin UI. Its observable contract is the SHAPE of the response object
// passed to res.apiv3():
//   - providers: ALL 4 supported providers are ALWAYS present (fixed slots,
//     Req 1.1), each carrying `enabled` + `isApiKeySet` booleans; only the
//     'azure-openai' entry carries `azureOpenaiSettings`.
//   - the stored API key VALUE is never present anywhere in the body; only the
//     per-provider `isApiKeySet` flag exposes its presence (Req 1.8, 1.9).
//   - allowedModels is the cross-provider allow-list, always an array (Req 1.1).
//   - aiEnabled / useOnlyEnvVars / isConfigured reflect their sources.
//   - on a collaborator failure the handler answers apiv3Err WITHOUT leaking a
//     key value into the error (Req 1.9).
// We mock every collaborator so the test exercises only this handler's mapping:
//   - configManager.getConfig(key): the AI enable toggle + env-only flag.
//   - the per-provider accessors (getProviderSettings / getApiKey) and the
//     allow-list accessor (getAllowedModels): owned by ai-sdk-modules and tested
//     there — they already apply masking/defensive guards.
//   - isAiConfigured(): the "enabled but not configured" verdict.
// AI_PROVIDERS (the declared provider set) is imported for real so the fixed-slot
// assertion tracks the single source of truth rather than a hard-coded list.
const { getConfig } = vi.hoisted(() => ({
  getConfig: vi.fn(),
}));
const { getProviderSettings, getApiKey, getAllowedModels } = vi.hoisted(() => ({
  getProviderSettings: vi.fn(),
  getApiKey: vi.fn(),
  getAllowedModels: vi.fn(),
}));
const { isAiConfigured } = vi.hoisted(() => ({
  isAiConfigured: vi.fn(),
}));

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig },
}));

vi.mock('../../services/ai-sdk-modules/llm-providers/config', () => ({
  getProviderSettings,
  getApiKey,
  getAllowedModels,
}));

vi.mock('~/features/mastra/server/services/is-ai-configured', () => ({
  isAiConfigured,
}));

import type { Request } from 'express';
import { mock } from 'vitest-mock-extended';

import {
  AI_PROVIDERS,
  type AiProvider,
} from '~/features/mastra/interfaces/ai-provider';
import type { AiProviderStatus } from '~/features/mastra/interfaces/ai-settings';
import type { AllowedModel } from '~/features/mastra/interfaces/allowed-model';
import type { AiProviderSettings } from '~/features/mastra/interfaces/provider-settings';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

import { getAiSettings } from './get-ai-settings';

type ConfigStub = Record<string, unknown>;

// The handler reads only the AI enable toggle + env-only flag directly from
// config; everything else comes through the accessors. Tests override only the
// fields they assert on; the rest stay at this baseline.
const setConfig = (overrides: ConfigStub = {}): void => {
  const base: ConfigStub = {
    'app:aiEnabled': false,
    'env:useOnlyEnvVars:ai': false,
    ...overrides,
  };
  getConfig.mockImplementation((key: string) => base[key]);
};

const setProviderSettings = (
  map: Partial<Record<AiProvider, AiProviderSettings>>,
): void => {
  getProviderSettings.mockImplementation(
    (provider: AiProvider) => map[provider],
  );
};

const setApiKeys = (map: Partial<Record<AiProvider, string>>): void => {
  getApiKey.mockImplementation((provider: AiProvider) => map[provider]);
};

const setAllowedModels = (models: AllowedModel[]): void => {
  getAllowedModels.mockReturnValue(models);
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

const providersOf = (
  res: ApiV3Response,
): Record<AiProvider, AiProviderStatus> =>
  responseBody(res).providers as Record<AiProvider, AiProviderStatus>;

beforeEach(() => {
  vi.clearAllMocks();
  isAiConfigured.mockReturnValue(false);
  setConfig();
  setProviderSettings({});
  setApiKeys({});
  setAllowedModels([]);
});

describe('getAiSettings (Req 1.1, 1.8, 1.9)', () => {
  it('returns a fixed slot for every supported provider, each with enabled + isApiKeySet booleans (Req 1.1)', () => {
    const { res } = invoke();

    const providers = providersOf(res);
    // Exactly the declared provider set — no more, no fewer (fixed slots).
    expect(Object.keys(providers).sort()).toEqual([...AI_PROVIDERS].sort());
    for (const provider of AI_PROVIDERS) {
      expect(providers).toHaveProperty(provider);
      expect(typeof providers[provider].enabled).toBe('boolean');
      expect(typeof providers[provider].isApiKeySet).toBe('boolean');
    }
  });

  it('reports each provider enabled flag from getProviderSettings(provider)?.enabled (Req 1.1)', () => {
    setProviderSettings({
      openai: { enabled: true },
      anthropic: { enabled: false },
      // google / azure-openai: no entry at all -> disabled
    });

    const providers = providersOf(invoke().res);

    expect(providers.openai.enabled).toBe(true);
    expect(providers.anthropic.enabled).toBe(false);
    expect(providers.google.enabled).toBe(false);
    expect(providers['azure-openai'].enabled).toBe(false);
  });

  it("carries azureOpenaiSettings only on the 'azure-openai' entry (Req 1.1)", () => {
    setProviderSettings({
      openai: { enabled: true },
      'azure-openai': {
        enabled: true,
        azureOpenaiSettings: { resourceName: 'my-resource', useEntraId: true },
      },
    });

    const providers = providersOf(invoke().res);

    expect(providers['azure-openai'].azureOpenaiSettings).toEqual({
      resourceName: 'my-resource',
      useEntraId: true,
    });
    for (const provider of AI_PROVIDERS) {
      if (provider === 'azure-openai') continue;
      expect(providers[provider]).not.toHaveProperty('azureOpenaiSettings');
    }
  });

  it('reports isApiKeySet=true and never exposes the key value when a provider key is set (Req 1.8, 1.9)', () => {
    setApiKeys({ openai: 'sk-super-secret-value' });

    const { res } = invoke();

    const body = responseBody(res);
    const providers = body.providers as Record<AiProvider, AiProviderStatus>;
    expect(providers.openai.isApiKeySet).toBe(true);
    // The actual secret must not appear under any field of the response.
    expect(JSON.stringify(body)).not.toContain('sk-super-secret-value');
    expect(providers.openai).not.toHaveProperty('apiKey');
  });

  it('reports isApiKeySet=false when a provider has no usable key (Req 1.8)', () => {
    // getApiKey is the single blankness authority: it normalizes an unset / blank /
    // whitespace-only stored key to undefined, so the admin GET only ever sees a
    // usable key or undefined, and isApiKeySet simply mirrors that presence.
    setApiKeys({ openai: undefined });

    const providers = providersOf(invoke().res);

    expect(providers.openai.isApiKeySet).toBe(false);
  });

  it('returns the allowedModels allow-list verbatim incl. provider, providerOptions and isDefault (Req 1.1)', () => {
    const models: AllowedModel[] = [
      {
        provider: 'openai',
        modelId: 'gpt-4o',
        isDefault: true,
        providerOptions: { openai: { temperature: 0.2 } },
      },
      { provider: 'anthropic', modelId: 'claude-3-5-sonnet' },
    ];
    setAllowedModels(models);

    expect(responseBody(invoke().res).allowedModels).toEqual(models);
  });

  it('returns allowedModels as an array (empty when none configured, Req 1.1)', () => {
    setAllowedModels([]);

    const body = responseBody(invoke().res);
    expect(Array.isArray(body.allowedModels)).toBe(true);
    expect(body.allowedModels).toEqual([]);
  });

  it('returns aiEnabled from app:aiEnabled', () => {
    setConfig({ 'app:aiEnabled': true });

    expect(responseBody(invoke().res).aiEnabled).toBe(true);
  });

  it('returns useOnlyEnvVars from env:useOnlyEnvVars:ai', () => {
    setConfig({ 'env:useOnlyEnvVars:ai': true });
    expect(responseBody(invoke().res).useOnlyEnvVars).toBe(true);

    setConfig({ 'env:useOnlyEnvVars:ai': false });
    expect(responseBody(invoke().res).useOnlyEnvVars).toBe(false);
  });

  it('returns isConfigured from isAiConfigured()', () => {
    isAiConfigured.mockReturnValue(true);

    const { res } = invoke();

    expect(responseBody(res).isConfigured).toBe(true);
    expect(isAiConfigured).toHaveBeenCalledTimes(1);
  });

  it('does not surface the removed single-provider top-level fields', () => {
    const body = responseBody(invoke().res);
    // These moved into the per-provider `providers` Record.
    expect(body).not.toHaveProperty('provider');
    expect(body).not.toHaveProperty('isApiKeySet');
    expect(body).not.toHaveProperty('azureOpenaiSettings');
  });

  it('responds with apiv3Err and does not leak a key value when a collaborator throws (Req 1.9)', () => {
    setApiKeys({ openai: 'sk-leak-me-not' });
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
