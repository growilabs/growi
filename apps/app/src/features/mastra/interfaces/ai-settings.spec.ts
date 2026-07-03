import {
  AI_SETTING_KEYS,
  type AiSettingsResponse,
  type AiSettingsUpdateRequest,
} from './ai-settings';

describe('ai-settings interfaces', () => {
  describe('AI_SETTING_KEYS', () => {
    // Contract: this list is the single source of truth for the config keys this
    // feature manages — the AI enablement toggle plus the 3 multi-provider
    // `ai:*` keys (providers Record, per-provider API key Record, cross-provider
    // allow-list).
    it('enumerates exactly the 4 managed config keys (app:aiEnabled + 3 ai:* keys)', () => {
      expect([...AI_SETTING_KEYS]).toStrictEqual([
        'app:aiEnabled',
        'ai:providers',
        'ai:providerApiKeys',
        'ai:allowedModels',
      ]);
    });

    it('no longer contains the legacy single-provider keys (Req 7.1)', () => {
      const keys: readonly string[] = AI_SETTING_KEYS;
      expect(keys).not.toContain('ai:provider');
      expect(keys).not.toContain('ai:apiKey');
      expect(keys).not.toContain('ai:azureOpenaiSettings');
    });

    it('contains no duplicate keys', () => {
      expect(new Set(AI_SETTING_KEYS).size).toBe(AI_SETTING_KEYS.length);
    });
  });

  describe('type-level usage (compile check)', () => {
    it('AiSettingsResponse and AiSettingsUpdateRequest are importable and shaped as designed', () => {
      // Fixed-slot model (Req 1.1/1.2): `providers` is a Record over ALL 4
      // supported providers — omitting a slot is a compile error.
      const response: AiSettingsResponse = {
        aiEnabled: true,
        providers: {
          openai: { enabled: true, isApiKeySet: true },
          anthropic: { enabled: false, isApiKeySet: false },
          google: { enabled: false, isApiKeySet: false },
          'azure-openai': {
            enabled: true,
            isApiKeySet: false,
            azureOpenaiSettings: {
              resourceName: 'my-resource',
              baseURL: 'https://example.openai.azure.com',
              apiVersion: '2024-02-01',
              useEntraId: true,
            },
          },
        },
        allowedModels: [
          {
            provider: 'openai',
            modelId: 'gpt-4o',
            providerOptions: { openai: { temperature: 0.2 } },
            isDefault: true,
          },
          // Cross-provider coexistence of the same modelId (Req 2.3)
          { provider: 'azure-openai', modelId: 'gpt-4o' },
        ],
        useOnlyEnvVars: false,
        isConfigured: true,
      };

      const updateRequest: AiSettingsUpdateRequest = {
        aiEnabled: true,
        providers: {
          openai: { enabled: true, apiKey: 'secret' },
          anthropic: { enabled: false },
          google: { enabled: false },
          'azure-openai': {
            enabled: true,
            azureOpenaiSettings: {
              resourceName: 'my-resource',
              useEntraId: true,
            },
          },
        },
        allowedModels: [
          { provider: 'openai', modelId: 'gpt-4o', isDefault: true },
        ],
      };

      // Every top-level section is optional: omitted = "leave that section
      // unchanged" (the design's PUT semantics), so an empty update is valid.
      const emptyUpdate: AiSettingsUpdateRequest = {};

      // An allowedModels-only update is valid (env-only mode sends just this
      // section — Req 5.3).
      const modelsOnlyUpdate: AiSettingsUpdateRequest = {
        allowedModels: [],
      };

      expect(
        response.providers['azure-openai'].azureOpenaiSettings?.useEntraId,
      ).toBe(true);
      expect(response.providers.openai.isApiKeySet).toBe(true);
      expect(response.allowedModels[0]?.provider).toBe('openai');
      expect(updateRequest.providers?.openai.apiKey).toBe('secret');
      expect(emptyUpdate).toStrictEqual({});
      expect(modelsOnlyUpdate.allowedModels).toStrictEqual([]);
    });
  });
});
