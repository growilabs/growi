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
  azureOpenaiResourceName: 'res',
  azureOpenaiBaseUrl: 'https://example.com',
  azureOpenaiApiVersion: '2024-02-01',
  azureOpenaiUseEntraId: false,
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
  azureOpenaiResourceName: '',
  azureOpenaiBaseUrl: '',
  azureOpenaiApiVersion: '',
  azureOpenaiUseEntraId: false,
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
      azureOpenaiResourceName: 'res',
      azureOpenaiBaseUrl: 'https://example.com',
      azureOpenaiApiVersion: '2024-02-01',
      azureOpenaiUseEntraId: false,
    });
  });

  it('falls back to the unselected sentinel and empty strings for absent values', () => {
    // Act
    const values = toFormValues({
      ...baseResponse,
      provider: undefined,
      model: undefined,
      providerOptions: undefined,
      azureOpenaiResourceName: undefined,
      azureOpenaiBaseUrl: undefined,
      azureOpenaiApiVersion: undefined,
    });

    // Assert
    expect(values.provider).toBe('');
    expect(values.model).toBe('');
    expect(values.providerOptions).toBe('');
    expect(values.azureOpenaiResourceName).toBe('');
    expect(values.azureOpenaiBaseUrl).toBe('');
    expect(values.azureOpenaiApiVersion).toBe('');
  });
});

describe('buildUpdateRequest', () => {
  it('always includes booleans and sends string fields as-is', () => {
    // Act
    const body = buildUpdateRequest({
      ...baseValues,
      aiEnabled: false,
      azureOpenaiUseEntraId: true,
      model: '',
    });

    // Assert
    expect(body).toMatchObject({
      aiEnabled: false,
      azureOpenaiUseEntraId: true,
      model: '', // empty strings are sent as-is (server normalizes, R4.4)
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
