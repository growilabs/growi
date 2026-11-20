import { describe, expect, it } from 'vitest';

import {
  buildInitialProviderOptionsText,
  getProviderOptionsNamespace,
} from './provider-options-namespace';

describe('getProviderOptionsNamespace', () => {
  it('maps each provider to the namespace key its AI SDK models read', () => {
    expect(getProviderOptionsNamespace('openai')).toBe('openai');
    expect(getProviderOptionsNamespace('anthropic')).toBe('anthropic');
    expect(getProviderOptionsNamespace('google')).toBe('google');
    // Azure OpenAI's chat model parses options under the `openai` key, not
    // `azure-openai` — this is the bug fix the mapping encodes.
    expect(getProviderOptionsNamespace('azure-openai')).toBe('openai');
  });

  it('returns null when no provider is selected', () => {
    expect(getProviderOptionsNamespace('')).toBeNull();
  });
});

describe('buildInitialProviderOptionsText', () => {
  it('starts a new model from an empty options object under the current provider namespace', () => {
    // The text must be valid JSON whose only key is the provider's namespace,
    // mapping to an empty object the admin then fills in.
    const text = buildInitialProviderOptionsText('anthropic');
    expect(JSON.parse(text)).toEqual({ anthropic: {} });
  });

  it('uses the openai namespace for azure-openai (not the provider id)', () => {
    const text = buildInitialProviderOptionsText('azure-openai');
    expect(JSON.parse(text)).toEqual({ openai: {} });
  });

  it('returns an empty string when no provider is selected', () => {
    expect(buildInitialProviderOptionsText('')).toBe('');
  });
});
