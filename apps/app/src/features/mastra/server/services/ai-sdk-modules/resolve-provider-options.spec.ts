import type { AllowedModel } from '~/features/mastra/interfaces/allowed-model';

// Drive the allow-list through the config boundary; resolveProviderOptions
// resolves per effective model via getAllowedModels/resolveEffectiveModel.
const { getConfig } = vi.hoisted(() => ({
  getConfig: vi.fn(),
}));

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig },
}));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { resolveProviderOptions } from './resolve-provider-options';

const setAllowedModels = (models: AllowedModel[] | undefined): void => {
  getConfig.mockImplementation((key: string) =>
    key === 'ai:allowedModels' ? models : undefined,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveProviderOptions', () => {
  it("returns the selected model's providerOptions when that model has options (Req 2.2)", () => {
    setAllowedModels([
      {
        model: 'gpt-5',
        isDefault: true,
        providerOptions: { openai: { reasoningEffort: 'high' } },
      },
      {
        model: 'o3',
        providerOptions: { openai: { reasoningEffort: 'low' } },
      },
    ]);

    expect(resolveProviderOptions('o3')).toEqual({
      openai: { reasoningEffort: 'low' },
    });
  });

  it('returns {} when the effective model entry has no providerOptions (Req 2.2)', () => {
    setAllowedModels([
      { model: 'gpt-4o', isDefault: true },
      { model: 'gpt-4o-mini' },
    ]);

    expect(resolveProviderOptions('gpt-4o-mini')).toEqual({});
  });

  it("returns the DEFAULT model's options for an out-of-allowlist modelId (per-effective-model resolution, Req 4.4)", () => {
    setAllowedModels([
      {
        model: 'gpt-5',
        isDefault: true,
        providerOptions: { openai: { reasoningEffort: 'high' } },
      },
      {
        model: 'o3',
        providerOptions: { openai: { reasoningEffort: 'low' } },
      },
    ]);

    // resolveEffectiveModel collapses the rejected id to the default, so the
    // default's options are applied — not the requested model's, not the
    // (nonexistent) requested entry's.
    expect(resolveProviderOptions('not-allowed')).toEqual({
      openai: { reasoningEffort: 'high' },
    });
  });

  it("resolves the default model's options when no modelId is given (Req 2.2)", () => {
    setAllowedModels([
      {
        model: 'gpt-5',
        isDefault: true,
        providerOptions: { openai: { reasoningEffort: 'high' } },
      },
      { model: 'o3' },
    ]);

    expect(resolveProviderOptions()).toEqual({
      openai: { reasoningEffort: 'high' },
    });
  });
});
