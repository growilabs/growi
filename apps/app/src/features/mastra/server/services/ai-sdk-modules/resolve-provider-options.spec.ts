import type { AllowedModel } from '~/features/mastra/interfaces/allowed-model';

// getProviderOptionsForModel is a pure allow-list lookup keyed by an ALREADY-
// RESOLVED effective model id — the caller rounds the client value once via
// resolveEffectiveModelId, so this function performs no resolution / rounding / warn
// of its own. Drive the allow-list through the config boundary.
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
  it("returns the model's providerOptions when the resolved entry declares them (Req 2.2)", () => {
    setAllowedModels([
      {
        modelId: 'gpt-5',
        isDefault: true,
        providerOptions: { openai: { reasoningEffort: 'high' } },
      },
      {
        modelId: 'o3',
        providerOptions: { openai: { reasoningEffort: 'low' } },
      },
    ]);

    expect(getProviderOptionsForModel('o3')).toEqual({
      openai: { reasoningEffort: 'low' },
    });
  });

  it('returns {} when the resolved entry declares no providerOptions (Req 2.2)', () => {
    setAllowedModels([
      { modelId: 'gpt-4o', isDefault: true },
      { modelId: 'gpt-4o-mini' },
    ]);

    expect(getProviderOptionsForModel('gpt-4o-mini')).toEqual({});
  });

  it('returns {} for an id absent from the allow-list (no rounding here — the caller resolves first)', () => {
    // This function deliberately does NOT round: collapsing an out-of-allowlist /
    // omitted id to the default is the caller's job (resolveEffectiveModelId, the
    // single checkpoint). A miss therefore yields {}, not the default's options —
    // callers must pass an already-effective id.
    setAllowedModels([
      {
        modelId: 'gpt-5',
        isDefault: true,
        providerOptions: { openai: { reasoningEffort: 'high' } },
      },
    ]);

    expect(getProviderOptionsForModel('not-in-list')).toEqual({});
  });
});
