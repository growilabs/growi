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
// The logger boundary: the failure path must log the situation WITHOUT the apiKey
// (Req 1.9), so we capture every logger.error argument and assert no secret leaks.
const { loggerError } = vi.hoisted(() => ({ loggerError: vi.fn() }));

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig },
}));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: loggerError,
    debug: vi.fn(),
  }),
}));

vi.mock('../../services/ai-sdk-modules/llm-providers/config', () => ({
  getProviderSettings,
  getApiKey,
  getAllowedModels,
}));

vi.mock('~/features/mastra/server/services/is-ai-configured', () => ({
  isAiConfigured,
}));

// buildModelDisplayNameResolver joins the allow-list with the effective catalog
// to attach official display names. Mocked at its boundary so this handler test
// stays a pure mapping test (no catalog/DB); the resolver just echoes the id so
// the allow-list assertions stay readable. Its own resolution is unit-tested in
// resolve-model-display-name.spec.
const { buildModelDisplayNameResolver } = vi.hoisted(() => ({
  buildModelDisplayNameResolver: vi.fn(),
}));
vi.mock('../../services/ai-sdk-modules/resolve-model-display-name', () => ({
  buildModelDisplayNameResolver,
}));

import type { Request } from 'express';
import { mock } from 'vitest-mock-extended';

import {
  AI_PROVIDERS,
  type AiProvider,
} from '~/features/mastra/interfaces/ai-provider';
import type {
  AiProviderStatus,
  AiSettingsResponse,
} from '~/features/mastra/interfaces/ai-settings';
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

const invoke = async () => {
  const req = mock<Request>();
  const res = mock<ApiV3Response>();
  await getAiSettings(req, res);
  return { res };
};

// Pull the single object the handler handed to res.apiv3(). Typed as the route's
// real response DTO so every field access below is typed with no cast (apiv3's
// parameter is `any`, so the payload flows into AiSettingsResponse implicitly).
const responseBody = (res: ApiV3Response): AiSettingsResponse => {
  const apiv3 = vi.mocked(res.apiv3);
  expect(apiv3).toHaveBeenCalledTimes(1);
  return apiv3.mock.calls[0][0];
};

const providersOf = (
  res: ApiV3Response,
): Record<AiProvider, AiProviderStatus> => responseBody(res).providers;

beforeEach(() => {
  vi.clearAllMocks();
  isAiConfigured.mockReturnValue(false);
  setConfig();
  setProviderSettings({});
  setApiKeys({});
  setAllowedModels([]);
  // Echo resolver: displayName === modelId. Keeps the allow-list assertions
  // focused on the handler's mapping, not on catalog name resolution.
  buildModelDisplayNameResolver.mockResolvedValue(
    (_provider: string, modelId: string) => modelId,
  );
});

describe('getAiSettings (Req 1.1, 1.8, 1.9)', () => {
  it('returns a fixed slot for every supported provider, each with enabled + isApiKeySet booleans (Req 1.1)', async () => {
    const { res } = await invoke();

    const providers = providersOf(res);
    // Exactly the declared provider set — no more, no fewer (fixed slots).
    expect(Object.keys(providers).sort()).toEqual([...AI_PROVIDERS].sort());
    for (const provider of AI_PROVIDERS) {
      expect(providers).toHaveProperty(provider);
      expect(typeof providers[provider].enabled).toBe('boolean');
      expect(typeof providers[provider].isApiKeySet).toBe('boolean');
    }
  });

  it('reports each provider enabled flag from getProviderSettings(provider)?.enabled (Req 1.1)', async () => {
    setProviderSettings({
      openai: { enabled: true },
      anthropic: { enabled: false },
      // google / azure-openai: no entry at all -> disabled
    });

    const providers = providersOf((await invoke()).res);

    expect(providers.openai.enabled).toBe(true);
    expect(providers.anthropic.enabled).toBe(false);
    expect(providers.google.enabled).toBe(false);
    expect(providers['azure-openai'].enabled).toBe(false);
  });

  it("carries azureOpenaiSettings only on the 'azure-openai' entry (Req 1.1)", async () => {
    setProviderSettings({
      openai: { enabled: true },
      'azure-openai': {
        enabled: true,
        azureOpenaiSettings: { resourceName: 'my-resource', useEntraId: true },
      },
    });

    const providers = providersOf((await invoke()).res);

    expect(providers['azure-openai'].azureOpenaiSettings).toEqual({
      resourceName: 'my-resource',
      useEntraId: true,
    });
    for (const provider of AI_PROVIDERS) {
      if (provider === 'azure-openai') continue;
      expect(providers[provider]).not.toHaveProperty('azureOpenaiSettings');
    }
  });

  it('reports isApiKeySet=true and never exposes the key value when a provider key is set (Req 1.8, 1.9)', async () => {
    setApiKeys({ openai: 'sk-super-secret-value' });

    const { res } = await invoke();

    const body = responseBody(res);
    const providers = body.providers;
    expect(providers.openai.isApiKeySet).toBe(true);
    // The actual secret must not appear under any field of the response.
    expect(JSON.stringify(body)).not.toContain('sk-super-secret-value');
    expect(providers.openai).not.toHaveProperty('apiKey');
  });

  it('reports isApiKeySet=false when a provider has no usable key (Req 1.8)', async () => {
    // getApiKey is the single blankness authority: it normalizes an unset / blank /
    // whitespace-only stored key to undefined, so the admin GET only ever sees a
    // usable key or undefined, and isApiKeySet simply mirrors that presence.
    setApiKeys({ openai: undefined });

    const providers = providersOf((await invoke()).res);

    expect(providers.openai.isApiKeySet).toBe(false);
  });

  it('returns the allowedModels allow-list incl. provider, providerOptions, isDefault, and the resolved displayName (Req 1.1)', async () => {
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

    // Each entry is carried through verbatim, plus a display-only `displayName`
    // resolved from the catalog (the echo resolver returns the modelId here).
    expect(responseBody((await invoke()).res).allowedModels).toEqual(
      models.map((m) => ({ ...m, displayName: m.modelId })),
    );
  });

  it('returns allowedModels as an array (empty when none configured, Req 1.1)', async () => {
    setAllowedModels([]);

    const body = responseBody((await invoke()).res);
    expect(Array.isArray(body.allowedModels)).toBe(true);
    expect(body.allowedModels).toEqual([]);
  });

  it('returns aiEnabled from app:aiEnabled', async () => {
    setConfig({ 'app:aiEnabled': true });

    expect(responseBody((await invoke()).res).aiEnabled).toBe(true);
  });

  it('returns useOnlyEnvVars from env:useOnlyEnvVars:ai', async () => {
    setConfig({ 'env:useOnlyEnvVars:ai': true });
    expect(responseBody((await invoke()).res).useOnlyEnvVars).toBe(true);

    setConfig({ 'env:useOnlyEnvVars:ai': false });
    expect(responseBody((await invoke()).res).useOnlyEnvVars).toBe(false);
  });

  it('returns isConfigured from isAiConfigured()', async () => {
    isAiConfigured.mockReturnValue(true);

    const { res } = await invoke();

    expect(responseBody(res).isConfigured).toBe(true);
    expect(isAiConfigured).toHaveBeenCalledTimes(1);
  });

  it('does not surface the removed single-provider top-level fields', async () => {
    const body = responseBody((await invoke()).res);
    // These moved into the per-provider `providers` Record.
    expect(body).not.toHaveProperty('provider');
    expect(body).not.toHaveProperty('isApiKeySet');
    expect(body).not.toHaveProperty('azureOpenaiSettings');
  });

  it('responds with apiv3Err and does not leak a key value when a collaborator throws (Req 1.9)', async () => {
    setApiKeys({ openai: 'sk-leak-me-not' });
    isAiConfigured.mockImplementation(() => {
      throw new Error('boom while computing configured state');
    });

    const { res } = await invoke();

    const apiv3Err = vi.mocked(res.apiv3Err);
    expect(apiv3Err).toHaveBeenCalledTimes(1);
    expect(res.apiv3).not.toHaveBeenCalled();
    // Sweep the WHOLE error response (every argument, serialized), not just
    // `.message`, so the key cannot hide in a non-message field of the ErrorV3.
    const serializedErrResponse = JSON.stringify(apiv3Err.mock.calls[0]);
    expect(serializedErrResponse).not.toContain('sk-leak-me-not');
    // The catch-path log must never carry the key either (Req 1.9). Assert the
    // handler logged the failure (so the assertion is real) and sweep every arg.
    expect(loggerError).toHaveBeenCalled();
    const serializedLogs = JSON.stringify(
      loggerError.mock.calls.map((call) =>
        call.map((arg) => (arg instanceof Error ? arg.message : arg)),
      ),
    );
    expect(serializedLogs).not.toContain('sk-leak-me-not');
  });
});
