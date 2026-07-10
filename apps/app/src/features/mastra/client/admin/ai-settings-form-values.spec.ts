import { describe, expect, it } from 'vitest';

import type { AiSettingsResponse } from '../../interfaces/ai-settings';
import type { AzureOpenaiConfig } from '../../interfaces/azure-openai-config';
import {
  type AiSettingsFormValues,
  type AllowedModelFormValue,
  buildUpdateRequest,
  evaluateFormProviderAvailability,
  findFirstInvalidProviderOptionsIndex,
  hasDirtyField,
  type ProviderFormValue,
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
      displayName: 'GPT-4o',
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
          displayName: 'GPT-4o',
        },
        {
          provider: 'anthropic',
          modelId: 'claude-3-5-sonnet',
          displayName: 'Claude 3.5 Sonnet',
        },
      ],
    });

    // Assert: the object is serialized to pretty-printed (2-space) JSON so it
    // re-seeds as readable multi-line text; the owning provider and display name
    // are preserved; an absent providerOptions => '' and an absent isDefault => false.
    expect(values.allowedModels).toEqual([
      {
        provider: 'openai',
        modelId: 'gpt-4o',
        providerOptionsText:
          '{\n  "openai": {\n    "reasoningEffort": "low"\n  }\n}',
        isDefault: true,
        displayName: 'GPT-4o',
      },
      {
        provider: 'anthropic',
        modelId: 'claude-3-5-sonnet',
        providerOptionsText: '',
        isDefault: false,
        displayName: 'Claude 3.5 Sonnet',
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

  it('trims surrounding whitespace off each modelId so it is stored canonically', () => {
    // A free-text modelId pasted with surrounding spaces must not ride verbatim
    // into the modelKey (model-not-found) or read as distinct from its trimmed twin.
    const body = buildUpdateRequest(
      {
        ...baseValues,
        allowedModels: [
          {
            provider: 'azure-openai',
            modelId: '  my-deployment  ',
            providerOptionsText: '',
            isDefault: true,
          },
        ],
      },
      false,
      true,
    );

    expect(body.allowedModels).toEqual([
      { provider: 'azure-openai', modelId: 'my-deployment', isDefault: true },
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

describe('evaluateFormProviderAvailability', () => {
  const openaiForm = (
    overrides: Partial<ProviderFormValue> = {},
  ): ProviderFormValue => ({
    enabled: true,
    apiKey: '',
    azureOpenaiSettings: emptyAzure,
    ...overrides,
  });

  it('is available for an enabled key-based provider whose key is only saved (no typed key)', () => {
    expect(
      evaluateFormProviderAvailability('openai', openaiForm(), true).available,
    ).toBe(true);
  });

  it('is available when a non-blank key is typed even without a saved key', () => {
    expect(
      evaluateFormProviderAvailability(
        'openai',
        openaiForm({ apiKey: 'sk-typed' }),
        false,
      ).available,
    ).toBe(true);
  });

  it('is misconfigured (missing-api-key) with neither a saved nor a non-blank typed key', () => {
    // A whitespace-only typed key does not count (mirrors the server blankness rule).
    expect(
      evaluateFormProviderAvailability(
        'openai',
        openaiForm({ apiKey: '   ' }),
        false,
      ),
    ).toEqual({ available: false, reason: 'missing-api-key' });
  });

  it('is disabled when the provider toggle is off, regardless of key', () => {
    expect(
      evaluateFormProviderAvailability(
        'openai',
        openaiForm({ enabled: false }),
        true,
      ),
    ).toEqual({ available: false, reason: 'disabled' });
  });

  it('treats an undefined form value (no slot yet) as disabled', () => {
    expect(
      evaluateFormProviderAvailability('openai', undefined, false),
    ).toEqual({ available: false, reason: 'disabled' });
  });
});

describe('findFirstInvalidProviderOptionsIndex', () => {
  const row = (
    overrides: Partial<AllowedModelFormValue> = {},
  ): AllowedModelFormValue => ({
    provider: 'openai',
    modelId: 'gpt-4o',
    providerOptionsText: '',
    isDefault: false,
    ...overrides,
  });

  it('returns -1 when every row is valid (empty and well-formed namespaced JSON)', () => {
    const models = [
      row({ providerOptionsText: '' }),
      row({ modelId: 'b', providerOptionsText: '{ "openai": {} }' }),
    ];
    expect(findFirstInvalidProviderOptionsIndex(models)).toBe(-1);
  });

  it('returns the flat-array index of the first syntactically invalid row', () => {
    const models = [
      row({ providerOptionsText: '{ "openai": {} }' }),
      row({
        provider: 'anthropic',
        modelId: 'x',
        providerOptionsText: '{oops',
      }),
    ];
    // The offending row is the second (index 1) — e.g. left on an inactive tab.
    expect(findFirstInvalidProviderOptionsIndex(models)).toBe(1);
  });

  it('flags a wrong-shape (well-formed but non-namespaced) value as invalid', () => {
    // Valid JSON that the runtime would ignore (a bare array), so it must be
    // rejected up front rather than parsed and sent.
    const models = [row({ providerOptionsText: '[]' })];
    expect(findFirstInvalidProviderOptionsIndex(models)).toBe(0);
  });

  it('returns -1 for an empty list', () => {
    expect(findFirstInvalidProviderOptionsIndex([])).toBe(-1);
  });
});
