import { describe, expect, it } from 'vitest';

import type { AiSettingsResponse } from '../../interfaces/ai-settings';
import type { AzureOpenaiConfig } from '../../interfaces/azure-openai-config';
import {
  type AiSettingsFormValues,
  type AllowedModelFormValue,
  buildUpdateRequest,
  hasDirtyField,
  setDefaultAllowedModelAt,
  toFormValues,
} from './ai-settings-form-values';

const emptyAzure: Required<AzureOpenaiConfig> = {
  resourceName: '',
  baseURL: '',
  apiVersion: '',
  useEntraId: false,
};

const baseResponse: AiSettingsResponse = {
  aiEnabled: true,
  providers: {
    openai: { enabled: true, isApiKeySet: true },
    anthropic: { enabled: false, isApiKeySet: false },
    google: { enabled: false, isApiKeySet: false },
    'azure-openai': {
      enabled: true,
      isApiKeySet: false,
      azureOpenaiSettings: {
        resourceName: 'res',
        baseURL: 'https://example.com',
        apiVersion: '2024-02-01',
        useEntraId: false,
      },
    },
  },
  allowedModels: [
    {
      provider: 'openai',
      modelId: 'gpt-4o',
      providerOptions: { openai: {} },
      isDefault: true,
    },
  ],
  useOnlyEnvVars: false,
  isConfigured: true,
};

const baseValues: AiSettingsFormValues = {
  aiEnabled: true,
  providers: {
    openai: { enabled: true, apiKey: '', azureOpenaiSettings: emptyAzure },
    anthropic: { enabled: false, apiKey: '', azureOpenaiSettings: emptyAzure },
    google: { enabled: false, apiKey: '', azureOpenaiSettings: emptyAzure },
    'azure-openai': {
      enabled: false,
      apiKey: '',
      azureOpenaiSettings: emptyAzure,
    },
  },
  allowedModels: [
    {
      provider: 'openai',
      modelId: 'gpt-4o',
      providerOptionsText: '',
      isDefault: true,
    },
  ],
};

describe('toFormValues', () => {
  it('builds a form entry for every supported provider with enabled from the response and apiKey never seeded', () => {
    // Act
    const values = toFormValues(baseResponse);

    // Assert: all 4 fixed-slot providers are present as form entries (R1.1).
    expect(Object.keys(values.providers).sort()).toEqual([
      'anthropic',
      'azure-openai',
      'google',
      'openai',
    ]);
    // enabled is copied from the response per provider.
    expect(values.providers.openai.enabled).toBe(true);
    expect(values.providers.anthropic.enabled).toBe(false);
    expect(values.providers['azure-openai'].enabled).toBe(true);
    // apiKey is write-only: it is NEVER seeded, even when isApiKeySet is true (R1.8).
    expect(values.providers.openai.apiKey).toBe('');
    expect(values.providers.anthropic.apiKey).toBe('');
    expect(values.providers['azure-openai'].apiKey).toBe('');
  });

  it('seeds the azure connection settings on the azure-openai entry', () => {
    // Act
    const values = toFormValues(baseResponse);

    // Assert
    expect(values.providers['azure-openai'].azureOpenaiSettings).toEqual({
      resourceName: 'res',
      baseURL: 'https://example.com',
      apiVersion: '2024-02-01',
      useEntraId: false,
    });
  });

  it('defaults every azure field to empty string / false when azureOpenaiSettings is absent', () => {
    // Act: no provider carries azureOpenaiSettings
    const values = toFormValues({
      ...baseResponse,
      providers: {
        openai: { enabled: true, isApiKeySet: false },
        anthropic: { enabled: false, isApiKeySet: false },
        google: { enabled: false, isApiKeySet: false },
        'azure-openai': { enabled: false, isApiKeySet: false },
      },
    });

    // Assert: controlled azure object built for every provider entry.
    expect(values.providers.openai.azureOpenaiSettings).toEqual(emptyAzure);
    expect(values.providers['azure-openai'].azureOpenaiSettings).toEqual(
      emptyAzure,
    );
  });

  it('flattens allowedModels into rows carrying provider, pretty-printed providerOptions text, and isDefault', () => {
    // Act
    const values = toFormValues({
      ...baseResponse,
      allowedModels: [
        {
          provider: 'openai',
          modelId: 'gpt-4o',
          providerOptions: { openai: { reasoningEffort: 'low' } },
          isDefault: true,
        },
        { provider: 'anthropic', modelId: 'claude-3-5-sonnet' },
      ],
    });

    // Assert: the object is serialized to pretty-printed (2-space) JSON so it
    // re-seeds as readable multi-line text; the owning provider is preserved;
    // an absent providerOptions => '' and an absent isDefault => false.
    expect(values.allowedModels).toEqual([
      {
        provider: 'openai',
        modelId: 'gpt-4o',
        providerOptionsText:
          '{\n  "openai": {\n    "reasoningEffort": "low"\n  }\n}',
        isDefault: true,
      },
      {
        provider: 'anthropic',
        modelId: 'claude-3-5-sonnet',
        providerOptionsText: '',
        isDefault: false,
      },
    ]);
  });

  it('copies aiEnabled and yields an empty allowedModels list when the response has none', () => {
    // Act
    const values = toFormValues({
      ...baseResponse,
      aiEnabled: false,
      allowedModels: [],
    });

    // Assert
    expect(values.aiEnabled).toBe(false);
    expect(values.allowedModels).toEqual([]);
  });
});

describe('buildUpdateRequest (normal mode)', () => {
  it('emits aiEnabled, all four provider entries, and allowedModels', () => {
    // Act
    const body = buildUpdateRequest(baseValues, false, true);

    // Assert
    expect(body.aiEnabled).toBe(true);
    expect(Object.keys(body.providers ?? {}).sort()).toEqual([
      'anthropic',
      'azure-openai',
      'google',
      'openai',
    ]);
    expect(body.allowedModels).toBeDefined();
    // Each provider entry forwards its enabled flag.
    expect(body.providers?.openai).toMatchObject({ enabled: true });
    expect(body.providers?.anthropic).toMatchObject({ enabled: false });
  });

  it('includes apiKey only for providers whose key was typed (blank keeps the stored key)', () => {
    // Act: openai left blank, anthropic given a new key (R1.4)
    const body = buildUpdateRequest(
      {
        ...baseValues,
        providers: {
          ...baseValues.providers,
          anthropic: {
            ...baseValues.providers.anthropic,
            apiKey: 'sk-new-key',
          },
        },
      },
      false,
      true,
    );

    // Assert
    expect(body.providers?.openai).not.toHaveProperty('apiKey');
    expect(body.providers?.anthropic).toMatchObject({ apiKey: 'sk-new-key' });
  });

  it('attaches azureOpenaiSettings only to the azure-openai entry', () => {
    // Act
    const body = buildUpdateRequest(baseValues, false, true);

    // Assert
    expect(body.providers?.openai).not.toHaveProperty('azureOpenaiSettings');
    expect(body.providers?.anthropic).not.toHaveProperty('azureOpenaiSettings');
    expect(body.providers?.['azure-openai']).toHaveProperty(
      'azureOpenaiSettings',
    );
    expect(body.providers?.['azure-openai'].azureOpenaiSettings).toEqual(
      emptyAzure,
    );
  });

  it('maps each allowedModel row, parsing providerOptionsText (empty/whitespace => omitted)', () => {
    // Act
    const body = buildUpdateRequest(
      {
        ...baseValues,
        allowedModels: [
          {
            provider: 'openai',
            modelId: 'gpt-4o',
            providerOptionsText: '{"openai":{"reasoningEffort":"low"}}',
            isDefault: true,
          },
          {
            provider: 'anthropic',
            modelId: 'claude-3-5-sonnet',
            providerOptionsText: '   ',
            isDefault: false,
          },
        ],
      },
      false,
      true,
    );

    // Assert: text parsed into the object; empty/whitespace text omits providerOptions (R2.3).
    expect(body.allowedModels).toEqual([
      {
        provider: 'openai',
        modelId: 'gpt-4o',
        providerOptions: { openai: { reasoningEffort: 'low' } },
        isDefault: true,
      },
      { provider: 'anthropic', modelId: 'claude-3-5-sonnet', isDefault: false },
    ]);
  });

  it('omits allowedModels (keeping aiEnabled + providers) when the list was not edited', () => {
    // A provider/apiKey/aiEnabled save must not carry an untouched allow-list, so
    // an env-seeded list with no default (rejected by the exactly-one-default PUT
    // rule) can never 400 an unrelated save.
    const body = buildUpdateRequest(baseValues, false, false);

    expect(body).not.toHaveProperty('allowedModels');
    expect(body.aiEnabled).toBe(true);
    expect(Object.keys(body.providers ?? {}).sort()).toEqual([
      'anthropic',
      'azure-openai',
      'google',
      'openai',
    ]);
  });
});

describe('buildUpdateRequest (env-only mode)', () => {
  it('emits only allowedModels, never providers or aiEnabled (R5.3)', () => {
    // Act
    const body = buildUpdateRequest(baseValues, true, true);

    // Assert: matches the server env-only 400 contract — connection settings and
    // the AI toggle must NOT be in the body; only model settings are editable.
    expect(Object.keys(body)).toEqual(['allowedModels']);
    expect(body).not.toHaveProperty('providers');
    expect(body).not.toHaveProperty('aiEnabled');
    expect(body.allowedModels).toEqual([
      { provider: 'openai', modelId: 'gpt-4o', isDefault: true },
    ]);
  });

  it('emits an empty body when the allow-list was not edited (nothing to save)', () => {
    const body = buildUpdateRequest(baseValues, true, false);

    expect(Object.keys(body)).toEqual([]);
  });
});

describe('hasDirtyField', () => {
  it('is false for an untouched subtree (undefined / empty)', () => {
    expect(hasDirtyField(undefined)).toBe(false);
    expect(hasDirtyField([])).toBe(false);
    expect(hasDirtyField({})).toBe(false);
  });

  it('is true when any leaf in a nested array/object is dirty', () => {
    // react-hook-form marks changed leaves `true`, leaving untouched rows sparse.
    expect(hasDirtyField([undefined, { modelId: true }])).toBe(true);
    expect(hasDirtyField([{ isDefault: false }])).toBe(false); // false != dirty
    expect(hasDirtyField({ nested: [{ a: true }] })).toBe(true);
  });
});

describe('setDefaultAllowedModelAt', () => {
  const models: AllowedModelFormValue[] = [
    {
      provider: 'openai',
      modelId: 'a',
      providerOptionsText: '',
      isDefault: true,
    },
    {
      provider: 'anthropic',
      modelId: 'b',
      providerOptionsText: '',
      isDefault: false,
    },
    {
      provider: 'google',
      modelId: 'c',
      providerOptionsText: '',
      isDefault: false,
    },
  ];

  it('sets exactly the target row as default and clears the rest', () => {
    // Act
    const result = setDefaultAllowedModelAt(models, 1);

    // Assert: exactly one default, at the target index (R3.1).
    expect(result.map((m) => m.isDefault)).toEqual([false, true, false]);
  });

  it('does not mutate the input array', () => {
    // Act
    const result = setDefaultAllowedModelAt(models, 2);

    // Assert
    expect(result).not.toBe(models);
    expect(models.map((m) => m.isDefault)).toEqual([true, false, false]);
  });

  it('normalizes a multi-default input to exactly the target', () => {
    // Arrange: an invalid state with two defaults
    const multiDefault: AllowedModelFormValue[] = [
      {
        provider: 'openai',
        modelId: 'a',
        providerOptionsText: '',
        isDefault: true,
      },
      {
        provider: 'anthropic',
        modelId: 'b',
        providerOptionsText: '',
        isDefault: true,
      },
      {
        provider: 'google',
        modelId: 'c',
        providerOptionsText: '',
        isDefault: false,
      },
    ];

    // Act
    const result = setDefaultAllowedModelAt(multiDefault, 2);

    // Assert
    expect(result.map((m) => m.isDefault)).toEqual([false, false, true]);
  });

  it('keeps the already-default target as the single default', () => {
    // Act
    const result = setDefaultAllowedModelAt(models, 0);

    // Assert
    expect(result.map((m) => m.isDefault)).toEqual([true, false, false]);
  });
});
