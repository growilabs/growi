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
  model: 'gpt-4o',
  providerOptions: '{"openai":{}}',
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
  model: 'gpt-4o',
  providerOptions: '',
  azureOpenaiSettings: {
    resourceName: '',
    baseURL: '',
    apiVersion: '',
    useEntraId: false,
  },
};

describe('toFormValues', () => {
  it('seeds string/boolean fields from the response and never seeds apiKey', () => {
    // Act
    const values = toFormValues(baseResponse);

    // Assert
    expect(values).toEqual({
      aiEnabled: true,
      provider: 'openai',
      apiKey: '', // write-only: never seeded from the server (R5.2)
      model: 'gpt-4o',
      providerOptions: '{"openai":{}}',
      azureOpenaiSettings: {
        resourceName: 'res',
        baseURL: 'https://example.com',
        apiVersion: '2024-02-01',
        useEntraId: false,
      },
    });
  });

  it('falls back to the unselected sentinel and empty strings for absent values', () => {
    // Act: an empty azureOpenaiSettings object means every inner field is absent
    const values = toFormValues({
      ...baseResponse,
      provider: undefined,
      model: undefined,
      providerOptions: undefined,
      azureOpenaiSettings: {},
    });

    // Assert
    expect(values.provider).toBe('');
    expect(values.model).toBe('');
    expect(values.providerOptions).toBe('');
    expect(values.azureOpenaiSettings).toEqual({
      resourceName: '',
      baseURL: '',
      apiVersion: '',
      useEntraId: false,
    });
  });
});

describe('buildUpdateRequest', () => {
  it('always includes aiEnabled and sends the azure object as-is', () => {
    // Act
    const body = buildUpdateRequest({
      ...baseValues,
      aiEnabled: false,
      azureOpenaiSettings: {
        ...baseValues.azureOpenaiSettings,
        useEntraId: true,
      },
      model: '',
    });

    // Assert
    expect(body).toMatchObject({
      aiEnabled: false,
      model: '', // empty strings are sent as-is (server normalizes, R4.4)
    });
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
