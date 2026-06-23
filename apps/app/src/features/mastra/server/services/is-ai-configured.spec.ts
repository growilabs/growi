import type { AllowedModel } from '~/features/mastra/interfaces/allowed-model';
import type { AzureOpenaiConfig } from '~/features/mastra/interfaces/azure-openai-config';

// --- Mock boundaries -------------------------------------------------------
//
// isAiConfigured composes three independent prerequisites read from config:
//   - ai:provider     (validated by the real isAiProvider)
//   - ai:apiKey       (read by the real getApiKey accessor)
//   - ai:allowedModels (read by the real getAllowedModels accessor)
// The genuine boundary is configManager.getConfig (the DB/env read), so we mock
// only that and let isAiProvider / getApiKey / getAllowedModels run for real.
// This keeps the test exercising the actual configured-verdict logic rather than
// re-stating it. isAiEnabled (the app:aiEnabled toggle) is the other collaborator
// for isAiReady's AND composition.
const { getConfig, isAiEnabled } = vi.hoisted(() => ({
  getConfig: vi.fn(),
  isAiEnabled: vi.fn(),
}));

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig },
}));

vi.mock('~/features/openai/server/services', () => ({
  isAiEnabled,
}));

import { isAiConfigured, isAiReady } from './is-ai-configured';

// Build a config-key reader from a plain map so each test states exactly the
// config it exercises. azureOpenaiSettings carries the Entra ID auth toggle that
// lets the Azure provider be configured without an apiKey (see the Entra cases).
const stubConfig = (values: {
  provider?: unknown;
  apiKey?: string;
  allowedModels?: AllowedModel[];
  azureOpenaiSettings?: AzureOpenaiConfig;
}): void => {
  getConfig.mockImplementation((key: string) => {
    switch (key) {
      case 'ai:provider':
        return values.provider;
      case 'ai:apiKey':
        return values.apiKey;
      case 'ai:allowedModels':
        return values.allowedModels;
      case 'ai:azureOpenaiSettings':
        return values.azureOpenaiSettings;
      default:
        return undefined;
    }
  });
};

const ONE_MODEL: AllowedModel[] = [{ modelId: 'gpt-4o', isDefault: true }];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isAiConfigured (Req 6.1)', () => {
  it('is true when provider + apiKey + a non-empty allow-list are all present', () => {
    stubConfig({
      provider: 'openai',
      apiKey: 'sk-test',
      allowedModels: ONE_MODEL,
    });

    expect(isAiConfigured()).toBe(true);
  });

  it('is false when the allow-list is empty even though provider + apiKey are set', () => {
    // "No allowed models" is the deliberate disabled state (Req 6.1): an empty
    // list must read as unconfigured, replacing the former single ai:model check.
    stubConfig({ provider: 'openai', apiKey: 'sk-test', allowedModels: [] });

    expect(isAiConfigured()).toBe(false);
  });

  it('is false when ai:allowedModels is unset (getConfig returns undefined → [])', () => {
    // DB-absent and the [] default are the same observable state; both unconfigured.
    stubConfig({
      provider: 'openai',
      apiKey: 'sk-test',
      allowedModels: undefined,
    });

    expect(isAiConfigured()).toBe(false);
  });

  it('is false when the provider is unset even with apiKey + non-empty allow-list', () => {
    stubConfig({
      provider: undefined,
      apiKey: 'sk-test',
      allowedModels: ONE_MODEL,
    });

    expect(isAiConfigured()).toBe(false);
  });

  it('is false when the provider is not a supported value', () => {
    stubConfig({
      provider: 'not-a-provider',
      apiKey: 'sk-test',
      allowedModels: ONE_MODEL,
    });

    expect(isAiConfigured()).toBe(false);
  });

  it('is false when the apiKey is unset even with provider + non-empty allow-list', () => {
    stubConfig({
      provider: 'openai',
      apiKey: undefined,
      allowedModels: ONE_MODEL,
    });

    expect(isAiConfigured()).toBe(false);
  });

  // Azure OpenAI + Microsoft Entra ID authenticates via a bearer token (no apiKey),
  // mirroring resolveAzureOpenaiModel which skips ai:apiKey when useEntraId === true.
  // Such a deployment must stay configured (Req 6.1: gating unchanged), so the apiKey
  // prerequisite is relaxed only for this exact provider+useEntraId combination. An
  // endpoint (resourceName here) is still required — see the endpoint cases below.
  it('is true for azure-openai with useEntraId + an endpoint even when apiKey is unset (Entra ID auth)', () => {
    stubConfig({
      provider: 'azure-openai',
      apiKey: undefined,
      allowedModels: ONE_MODEL,
      azureOpenaiSettings: { useEntraId: true, resourceName: 'my-resource' },
    });

    expect(isAiConfigured()).toBe(true);
  });

  it('is true for azure-openai with apiKey + an endpoint (key auth)', () => {
    stubConfig({
      provider: 'azure-openai',
      apiKey: 'sk-test',
      allowedModels: ONE_MODEL,
      azureOpenaiSettings: { resourceName: 'my-resource' },
    });

    expect(isAiConfigured()).toBe(true);
  });

  it('is true for azure-openai when the endpoint is given as baseURL instead of resourceName', () => {
    stubConfig({
      provider: 'azure-openai',
      apiKey: 'sk-test',
      allowedModels: ONE_MODEL,
      azureOpenaiSettings: { baseURL: 'https://example.openai.azure.com' },
    });

    expect(isAiConfigured()).toBe(true);
  });

  it('is false for azure-openai WITHOUT useEntraId when apiKey is unset (key auth required)', () => {
    stubConfig({
      provider: 'azure-openai',
      apiKey: undefined,
      allowedModels: ONE_MODEL,
      azureOpenaiSettings: { useEntraId: false, resourceName: 'my-resource' },
    });

    expect(isAiConfigured()).toBe(false);
  });

  it('is false for azure-openai with useEntraId when the allow-list is empty', () => {
    // The Entra relaxation only waives apiKey; a non-empty allow-list is still required.
    stubConfig({
      provider: 'azure-openai',
      apiKey: undefined,
      allowedModels: [],
      azureOpenaiSettings: { useEntraId: true, resourceName: 'my-resource' },
    });

    expect(isAiConfigured()).toBe(false);
  });

  // resolveAzureOpenaiModel throws when neither resourceName nor baseURL is set
  // (endpoint mandatory regardless of auth method). isAiConfigured must mirror that:
  // an Azure deployment with credentials but no endpoint is NOT ready — reporting it
  // ready would gate AI on, then fail every chat request at resolve time (Req 6.1).
  it('is false for azure-openai (key auth) when neither resourceName nor baseURL is set', () => {
    stubConfig({
      provider: 'azure-openai',
      apiKey: 'sk-test',
      allowedModels: ONE_MODEL,
      azureOpenaiSettings: { apiVersion: '2024-02-01' },
    });

    expect(isAiConfigured()).toBe(false);
  });

  it('is false for azure-openai (Entra ID) when neither resourceName nor baseURL is set', () => {
    stubConfig({
      provider: 'azure-openai',
      apiKey: undefined,
      allowedModels: ONE_MODEL,
      azureOpenaiSettings: { useEntraId: true },
    });

    expect(isAiConfigured()).toBe(false);
  });

  it('is false for azure-openai when ai:azureOpenaiSettings is unset entirely', () => {
    stubConfig({
      provider: 'azure-openai',
      apiKey: 'sk-test',
      allowedModels: ONE_MODEL,
      azureOpenaiSettings: undefined,
    });

    expect(isAiConfigured()).toBe(false);
  });
});

describe('isAiReady (Req 6.1)', () => {
  const configured = (): void =>
    stubConfig({
      provider: 'openai',
      apiKey: 'sk-test',
      allowedModels: ONE_MODEL,
    });

  it('is true only when AI is enabled AND configured', () => {
    isAiEnabled.mockReturnValue(true);
    configured();

    expect(isAiReady()).toBe(true);
  });

  it('is false when AI is disabled even though it is configured', () => {
    isAiEnabled.mockReturnValue(false);
    configured();

    expect(isAiReady()).toBe(false);
  });

  it('is false when AI is enabled but the allow-list is empty (not configured)', () => {
    isAiEnabled.mockReturnValue(true);
    stubConfig({ provider: 'openai', apiKey: 'sk-test', allowedModels: [] });

    expect(isAiReady()).toBe(false);
  });

  it('is false when AI is both disabled and not configured', () => {
    isAiEnabled.mockReturnValue(false);
    stubConfig({ provider: undefined, apiKey: undefined, allowedModels: [] });

    expect(isAiReady()).toBe(false);
  });
});
