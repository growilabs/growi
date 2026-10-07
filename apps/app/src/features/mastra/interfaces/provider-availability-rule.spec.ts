import { describe, expect, it } from 'vitest';

import type {
  ProviderAvailability,
  ProviderAvailabilityInput,
} from './provider-availability-rule';
import { evaluateProviderAvailability } from './provider-availability-rule';

// evaluateProviderAvailability is a pure function; the contract is the returned
// verdict (available + reason) for each combination of enabled / hasApiKey /
// azure endpoint / Entra ID / provider. The matrix below drives every meaningful
// cell; the assertion is the returned value only (no internals to spy on).

interface Case {
  readonly name: string;
  readonly input: ProviderAvailabilityInput;
  readonly expected: ProviderAvailability;
}

describe('evaluateProviderAvailability', () => {
  describe('disabled (enabled === false) short-circuits regardless of anything else', () => {
    const cases: Case[] = [
      {
        name: 'key-based provider, no key',
        input: { provider: 'openai', enabled: false, hasApiKey: false },
        expected: { available: false, reason: 'disabled' },
      },
      {
        name: 'key-based provider, key present',
        input: { provider: 'openai', enabled: false, hasApiKey: true },
        expected: { available: false, reason: 'disabled' },
      },
      {
        name: 'azure with a complete endpoint + key',
        input: {
          provider: 'azure-openai',
          enabled: false,
          hasApiKey: true,
          azureOpenaiSettings: { resourceName: 'my-res' },
        },
        expected: { available: false, reason: 'disabled' },
      },
    ];

    it.each(cases)('$name', ({ input, expected }) => {
      expect(evaluateProviderAvailability(input)).toEqual(expected);
    });
  });

  describe('key-based providers (openai / anthropic / google)', () => {
    const cases: Case[] = [
      {
        name: 'openai enabled with a key is available',
        input: { provider: 'openai', enabled: true, hasApiKey: true },
        expected: { available: true },
      },
      {
        name: 'anthropic enabled with a key is available',
        input: { provider: 'anthropic', enabled: true, hasApiKey: true },
        expected: { available: true },
      },
      {
        name: 'google enabled with a key is available',
        input: { provider: 'google', enabled: true, hasApiKey: true },
        expected: { available: true },
      },
      {
        name: 'openai enabled without a key is missing-api-key',
        input: { provider: 'openai', enabled: true, hasApiKey: false },
        expected: { available: false, reason: 'missing-api-key' },
      },
      {
        name: 'anthropic enabled without a key is missing-api-key',
        input: { provider: 'anthropic', enabled: true, hasApiKey: false },
        expected: { available: false, reason: 'missing-api-key' },
      },
      {
        name: 'key-based provider ignores azureOpenaiSettings entirely',
        input: {
          provider: 'openai',
          enabled: true,
          hasApiKey: true,
          // Even a blank azure endpoint must not affect a key-based provider.
          azureOpenaiSettings: { resourceName: '', baseURL: '' },
        },
        expected: { available: true },
      },
    ];

    it.each(cases)('$name', ({ input, expected }) => {
      expect(evaluateProviderAvailability(input)).toEqual(expected);
    });
  });

  describe('azure-openai (endpoint checked before the key)', () => {
    const cases: Case[] = [
      {
        name: 'resourceName endpoint + key is available',
        input: {
          provider: 'azure-openai',
          enabled: true,
          hasApiKey: true,
          azureOpenaiSettings: { resourceName: 'my-res' },
        },
        expected: { available: true },
      },
      {
        name: 'baseURL endpoint + key is available',
        input: {
          provider: 'azure-openai',
          enabled: true,
          hasApiKey: true,
          azureOpenaiSettings: { baseURL: 'https://x.openai.azure.com' },
        },
        expected: { available: true },
      },
      {
        name: 'endpoint + Entra ID waives the key (available without a key)',
        input: {
          provider: 'azure-openai',
          enabled: true,
          hasApiKey: false,
          azureOpenaiSettings: { resourceName: 'my-res', useEntraId: true },
        },
        expected: { available: true },
      },
      {
        name: 'no endpoint at all is missing-azure-endpoint',
        input: {
          provider: 'azure-openai',
          enabled: true,
          hasApiKey: true,
          azureOpenaiSettings: {},
        },
        expected: { available: false, reason: 'missing-azure-endpoint' },
      },
      {
        name: 'undefined azureOpenaiSettings is missing-azure-endpoint',
        input: { provider: 'azure-openai', enabled: true, hasApiKey: true },
        expected: { available: false, reason: 'missing-azure-endpoint' },
      },
      {
        name: 'blank/whitespace endpoint counts as absent (missing-azure-endpoint)',
        input: {
          provider: 'azure-openai',
          enabled: true,
          hasApiKey: true,
          azureOpenaiSettings: { resourceName: '   ', baseURL: '' },
        },
        expected: { available: false, reason: 'missing-azure-endpoint' },
      },
      {
        name: 'endpoint precedence: missing key AND missing endpoint reports the endpoint',
        input: {
          provider: 'azure-openai',
          enabled: true,
          hasApiKey: false,
          azureOpenaiSettings: {},
        },
        expected: { available: false, reason: 'missing-azure-endpoint' },
      },
      {
        name: 'endpoint present but key missing and Entra ID off is missing-api-key',
        input: {
          provider: 'azure-openai',
          enabled: true,
          hasApiKey: false,
          azureOpenaiSettings: { resourceName: 'my-res' },
        },
        expected: { available: false, reason: 'missing-api-key' },
      },
      {
        name: 'endpoint present, key missing, Entra ID explicitly false is missing-api-key',
        input: {
          provider: 'azure-openai',
          enabled: true,
          hasApiKey: false,
          azureOpenaiSettings: {
            baseURL: 'https://x.openai.azure.com',
            useEntraId: false,
          },
        },
        expected: { available: false, reason: 'missing-api-key' },
      },
    ];

    it.each(cases)('$name', ({ input, expected }) => {
      expect(evaluateProviderAvailability(input)).toEqual(expected);
    });
  });
});
