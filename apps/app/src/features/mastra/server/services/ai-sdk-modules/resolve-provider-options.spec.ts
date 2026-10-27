import type { AllowedModel } from '~/features/mastra/interfaces/allowed-model';

// getProviderOptionsForModel is a pure allow-list lookup keyed by an ALREADY-
// RESOLVED effective modelKey. It parses the key into (provider, modelId) and
// matches the allow-list entry by BOTH fields (Req 2.8 / D1), so options never
// leak across providers that happen to share a modelId. The caller rounds the
// client value once (resolveEffectiveModelKey — the single checkpoint) and threads
// the result here, so this performs NO resolution / rounding / warn of its own.
// Drive the allow-list through the config boundary; parseModelKey runs for real.
const { getConfig } = vi.hoisted(() => ({
  getConfig: vi.fn(),
}));

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig },
}));

import { getProviderOptionsForModel } from './resolve-provider-options';

const setAllowedModels = (models: AllowedModel[] | undefined): void => {
  getConfig.mockImplementation((key: string) =>
    key === 'ai:allowedModels' ? models : undefined,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getProviderOptionsForModel', () => {
  it("returns the matched entry's providerOptions (Req 2.8)", () => {
    setAllowedModels([
      {
        provider: 'openai',
        modelId: 'gpt-5',
        isDefault: true,
        providerOptions: { openai: { reasoningEffort: 'high' } },
      },
      {
        provider: 'openai',
        modelId: 'o3',
        providerOptions: { openai: { reasoningEffort: 'low' } },
      },
    ]);

    expect(getProviderOptionsForModel('openai/o3')).toEqual({
      openai: { reasoningEffort: 'low' },
    });
  });

  it('matches on the (provider, modelId) pair: the SAME modelId under different providers keeps its OWN options (Req 2.3, 2.8 — regression guard)', () => {
    // The critical multi-provider fix. Two providers register the SAME modelId;
    // matching on modelId alone (the old behavior) would collide and return the
    // first entry's options for both. Matching the (provider, modelId) pair
    // returns each entry's own options.
    setAllowedModels([
      {
        provider: 'openai',
        modelId: 'shared-id',
        isDefault: true,
        providerOptions: { openai: { reasoningEffort: 'high' } },
      },
      {
        provider: 'anthropic',
        modelId: 'shared-id',
        providerOptions: {
          anthropic: { thinking: { type: 'enabled', budgetTokens: 12000 } },
        },
      },
    ]);

    expect(getProviderOptionsForModel('openai/shared-id')).toEqual({
      openai: { reasoningEffort: 'high' },
    });
    expect(getProviderOptionsForModel('anthropic/shared-id')).toEqual({
      anthropic: { thinking: { type: 'enabled', budgetTokens: 12000 } },
    });
  });

  it('returns {} when the matched entry declares no providerOptions', () => {
    setAllowedModels([
      { provider: 'openai', modelId: 'gpt-4o', isDefault: true },
      { provider: 'openai', modelId: 'gpt-4o-mini' },
    ]);

    expect(getProviderOptionsForModel('openai/gpt-4o-mini')).toEqual({});
  });

  it('returns {} for a (provider, modelId) pair absent from the allow-list (no rounding here — the caller resolves first)', () => {
    // This function deliberately does NOT round: collapsing an out-of-allowlist /
    // omitted key to the default is the caller's job (resolveEffectiveModelKey, the
    // single checkpoint). A miss therefore yields {}, not the default's options.
    setAllowedModels([
      {
        provider: 'openai',
        modelId: 'gpt-5',
        isDefault: true,
        providerOptions: { openai: { reasoningEffort: 'high' } },
      },
    ]);

    // Right modelId, wrong provider → miss (no cross-provider fallback).
    expect(getProviderOptionsForModel('anthropic/gpt-5')).toEqual({});
    // Absent modelId under the right provider → miss.
    expect(getProviderOptionsForModel('openai/not-in-list')).toEqual({});
  });

  it('returns {} for an unparseable key (defensive)', () => {
    setAllowedModels([
      {
        provider: 'openai',
        modelId: 'gpt-5',
        isDefault: true,
        providerOptions: { openai: { reasoningEffort: 'high' } },
      },
    ]);

    // No separator at all, and an unknown provider prefix — both fail to parse.
    expect(getProviderOptionsForModel('no-separator')).toEqual({});
    expect(getProviderOptionsForModel('cohere/gpt-5')).toEqual({});
  });

  it('returns {} when the allow-list is unset or empty', () => {
    setAllowedModels(undefined);
    expect(getProviderOptionsForModel('openai/gpt-5')).toEqual({});

    setAllowedModels([]);
    expect(getProviderOptionsForModel('openai/gpt-5')).toEqual({});
  });
});
