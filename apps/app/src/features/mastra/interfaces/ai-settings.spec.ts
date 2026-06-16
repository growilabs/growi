import type { AiProvider } from './ai-provider';
import {
  AI_SETTING_KEYS,
  type AiSettingsResponse,
  type AiSettingsUpdateRequest,
} from './ai-settings';

describe('ai-settings interfaces', () => {
  describe('AI_SETTING_KEYS', () => {
    // Contract: this list is the single source of truth for the config keys this
    // feature manages (the env-only group mirrors it). It must contain exactly
    // these 6 keys — the Azure connection config is one ai:azureOpenaiSettings JSON object.
    it('enumerates exactly the 6 editable config keys (app:aiEnabled + 5 ai:* keys)', () => {
      expect([...AI_SETTING_KEYS]).toStrictEqual([
        'app:aiEnabled',
        'ai:provider',
        'ai:apiKey',
        'ai:model',
        'ai:providerOptions',
        'ai:azureOpenaiSettings',
      ]);
    });

    it('contains no duplicate keys', () => {
      expect(new Set(AI_SETTING_KEYS).size).toBe(AI_SETTING_KEYS.length);
    });
  });

  describe('type-level usage (compile check)', () => {
    it('AiSettingsResponse and AiSettingsUpdateRequest are importable and shaped as designed', () => {
      const provider: AiProvider = 'azure-openai';

      const response: AiSettingsResponse = {
        aiEnabled: true,
        provider,
        model: 'gpt-4o',
        providerOptions: '{"openai":{"temperature":0.2}}',
        azureOpenaiSettings: {
          resourceName: 'my-resource',
          baseURL: 'https://example.openai.azure.com',
          apiVersion: '2024-02-01',
          useEntraId: false,
        },
        isApiKeySet: true,
        useOnlyEnvVars: false,
        isConfigured: true,
      };

      const updateRequest: AiSettingsUpdateRequest = {
        aiEnabled: true,
        provider,
        apiKey: 'secret',
        model: 'gpt-4o',
        providerOptions: '{}',
        azureOpenaiSettings: {
          resourceName: 'my-resource',
          baseURL: 'https://example.openai.azure.com',
          apiVersion: '2024-02-01',
          useEntraId: true,
        },
      };

      // The minimal-required shape: only the non-optional response fields
      // (azureOpenaiSettings is always present — an empty object is valid).
      const minimalResponse: AiSettingsResponse = {
        aiEnabled: false,
        azureOpenaiSettings: {},
        isApiKeySet: false,
        useOnlyEnvVars: false,
        isConfigured: false,
      };

      // An empty update is valid because every field is optional.
      const emptyUpdate: AiSettingsUpdateRequest = {};

      expect(response.provider).toBe('azure-openai');
      expect(updateRequest.apiKey).toBe('secret');
      expect(minimalResponse.aiEnabled).toBe(false);
      expect(emptyUpdate).toStrictEqual({});
    });
  });
});
