import { describe, expect, it } from 'vitest';

import type { AiSettingsResponse } from '../../interfaces/ai-settings';
import {
  type AiSettingsFormValues,
  buildUpdateRequest,
  toFormValues,
} from './ai-settings-form-values';

const baseResponse: AiSettingsResponse = {
  aiEnabled: true,
  provider: 'openai',
  allowedModels: [
    { modelId: 'gpt-4o', providerOptions: { openai: {} }, isDefault: true },
  ],
  azureOpenaiSettings: {
    resourceName: 'res',
    baseURL: 'https://example.com',
    apiVersion: '2024-02-01',
    useEntraId: false,
  },
  isApiKeySet: true,
  useOnlyEnvVars: false,
  isConfigured: true,
};

const baseValues: AiSettingsFormValues = {
  aiEnabled: true,
  provider: 'openai',
  apiKey: '',
  allowedModels: [
    { modelId: 'gpt-4o', providerOptionsText: '', isDefault: true },
  ],
  azureOpenaiSettings: {
    resourceName: '',
    baseURL: '',
    apiVersion: '',
    useEntraId: false,
  },
};

describe('toFormValues', () => {
  it('stringifies each model providerOptions into providerOptionsText and copies isDefault', () => {
    // Act
    const values = toFormValues({
      ...baseResponse,
      allowedModels: [
        {
          modelId: 'gpt-4o',
          providerOptions: { openai: { reasoningEffort: 'low' } },
          isDefault: true,
        },
        { modelId: 'gpt-4o-mini', isDefault: false },
      ],
    });

    // Assert: the object is serialized to JSON text; isDefault is preserved.
    expect(values.allowedModels).toEqual([
      {
        modelId: 'gpt-4o',
        providerOptionsText: '{"openai":{"reasoningEffort":"low"}}',
        isDefault: true,
      },
      { modelId: 'gpt-4o-mini', providerOptionsText: '', isDefault: false },
    ]);
  });

  it('uses an empty providerOptionsText when a model has no providerOptions', () => {
    // Act
    const values = toFormValues({
      ...baseResponse,
      allowedModels: [{ modelId: 'gpt-4o' }],
    });

    // Assert: absent providerOptions => '' (so the textarea binds to a string),
    // and absent isDefault => false.
    expect(values.allowedModels).toEqual([
      { modelId: 'gpt-4o', providerOptionsText: '', isDefault: false },
    ]);
  });

  it('seeds the remaining string/boolean fields and never seeds apiKey', () => {
    // Act
    const values = toFormValues(baseResponse);

    // Assert
    expect(values).toMatchObject({
      aiEnabled: true,
      provider: 'openai',
      apiKey: '', // write-only: never seeded from the server (R5.2)
      azureOpenaiSettings: {
        resourceName: 'res',
        baseURL: 'https://example.com',
        apiVersion: '2024-02-01',
        useEntraId: false,
      },
    });
  });

  it('falls back to the unselected sentinel, an empty list, and empty strings for absent values', () => {
    // Act: an empty azureOpenaiSettings object means every inner field is absent
    const values = toFormValues({
      ...baseResponse,
      provider: undefined,
      allowedModels: [],
      azureOpenaiSettings: {},
    });

    // Assert
    expect(values.provider).toBe('');
    expect(values.allowedModels).toEqual([]);
    expect(values.azureOpenaiSettings).toEqual({
      resourceName: '',
      baseURL: '',
      apiVersion: '',
      useEntraId: false,
    });
  });
});

describe('buildUpdateRequest', () => {
  it('parses each providerOptionsText into providerOptions and copies isDefault', () => {
    // Act
    const body = buildUpdateRequest({
      ...baseValues,
      allowedModels: [
        {
          modelId: 'gpt-4o',
          providerOptionsText: '{"openai":{"reasoningEffort":"low"}}',
          isDefault: true,
        },
        { modelId: 'gpt-4o-mini', providerOptionsText: '', isDefault: false },
      ],
    });

    // Assert: text is parsed into the object; empty text omits providerOptions.
    expect(body.allowedModels).toEqual([
      {
        modelId: 'gpt-4o',
        providerOptions: { openai: { reasoningEffort: 'low' } },
        isDefault: true,
      },
      { modelId: 'gpt-4o-mini', isDefault: false },
    ]);
  });

  it('omits providerOptions for whitespace-only providerOptionsText', () => {
    // Act
    const body = buildUpdateRequest({
      ...baseValues,
      allowedModels: [
        { modelId: 'gpt-4o', providerOptionsText: '   ', isDefault: true },
      ],
    });

    // Assert: a whitespace-only text is treated as "no options" (R2.3).
    expect(body.allowedModels).toEqual([
      { modelId: 'gpt-4o', isDefault: true },
    ]);
  });

  it('always includes aiEnabled and sends the azure object as-is', () => {
    // Act
    const body = buildUpdateRequest({
      ...baseValues,
      aiEnabled: false,
      azureOpenaiSettings: {
        ...baseValues.azureOpenaiSettings,
        useEntraId: true,
      },
    });

    // Assert
    expect(body).toMatchObject({ aiEnabled: false });
    // The azure object is forwarded verbatim (the server drops empty fields).
    expect(body.azureOpenaiSettings).toEqual({
      resourceName: '',
      baseURL: '',
      apiVersion: '',
      useEntraId: true,
    });
  });

  it('omits apiKey when blank and includes it when present', () => {
    expect(buildUpdateRequest(baseValues)).not.toHaveProperty('apiKey');
    expect(
      buildUpdateRequest({ ...baseValues, apiKey: 'sk-123' }),
    ).toMatchObject({ apiKey: 'sk-123' });
  });

  it('converts the unselected provider sentinel to undefined', () => {
    // Act
    const body = buildUpdateRequest({ ...baseValues, provider: '' });

    // Assert
    expect(body.provider).toBeUndefined();
  });
});
