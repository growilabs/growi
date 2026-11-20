import type { AllowedModel } from '~/features/mastra/interfaces/allowed-model';

// --- Mock boundaries -------------------------------------------------------
//
// isAiConfigured delegates the "enabled provider ≥1 ∧ its allowed models ≥1"
// judgement to provider-availability's getAvailableModels (design D3): that
// accessor already filters the allow-list down to available (enabled AND
// configured) providers, so a non-empty result is exactly the configured
// condition. isAiReady ANDs the app:aiEnabled toggle (isAiEnabled) on top.
//
// We mock exactly those two seams so the verdict matrix is driven
// deterministically without wiring real config. This intentionally does NOT
// re-test provider-availability's internals — its own spec (task 3.2) owns the
// disabled / misconfigured / legacy-key reductions. Here we pin only that
// isAiConfigured mirrors the available-model count and that isAiReady combines
// that verdict with the enabled toggle.
const { getAvailableModels, isAiEnabled } = vi.hoisted(() => ({
  getAvailableModels: vi.fn<() => AllowedModel[]>(),
  isAiEnabled: vi.fn<() => boolean>(),
}));

vi.mock('./ai-sdk-modules/llm-providers/provider-availability', () => ({
  getAvailableModels,
}));

vi.mock('./is-ai-enabled', () => ({
  isAiEnabled,
}));

import { isAiConfigured, isAiReady } from './is-ai-configured';

const ONE_MODEL: AllowedModel[] = [
  { provider: 'openai', modelId: 'gpt-4o', isDefault: true },
];
const TWO_MODELS: AllowedModel[] = [
  { provider: 'openai', modelId: 'gpt-4o', isDefault: true },
  { provider: 'anthropic', modelId: 'claude-sonnet-5' },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isAiConfigured (Req 6.2, 6.3, 7.3)', () => {
  it('is true when at least one available model exists (Req 6.2)', () => {
    getAvailableModels.mockReturnValue(ONE_MODEL);

    expect(isAiConfigured()).toBe(true);
  });

  it('is true regardless of how many available models exist (count > 1)', () => {
    getAvailableModels.mockReturnValue(TWO_MODELS);

    expect(isAiConfigured()).toBe(true);
  });

  it('is false when there are no available models (Req 6.3, 7.3)', () => {
    // An empty available-model set is the single collapsed observation of every
    // "unconfigured" cause: all providers disabled, all enabled providers
    // misconfigured, or only legacy single-provider settings remain (the removed
    // ai:provider/ai:apiKey keys leave ai:providers unset). provider-availability
    // reduces all of these to []; here we assert isAiConfigured reads that as
    // not-configured so the app continues with chat disabled (Req 6.3, 7.3).
    getAvailableModels.mockReturnValue([]);

    expect(isAiConfigured()).toBe(false);
  });
});

describe('isAiReady (Req 6.2, 6.3)', () => {
  it('is true only when AI is enabled AND configured', () => {
    isAiEnabled.mockReturnValue(true);
    getAvailableModels.mockReturnValue(ONE_MODEL);

    expect(isAiReady()).toBe(true);
  });

  it('is false when AI is disabled even though it is configured', () => {
    isAiEnabled.mockReturnValue(false);
    getAvailableModels.mockReturnValue(ONE_MODEL);

    expect(isAiReady()).toBe(false);
  });

  it('is false when AI is enabled but not configured (no available models)', () => {
    isAiEnabled.mockReturnValue(true);
    getAvailableModels.mockReturnValue([]);

    expect(isAiReady()).toBe(false);
  });

  it('is false when AI is both disabled and not configured', () => {
    isAiEnabled.mockReturnValue(false);
    getAvailableModels.mockReturnValue([]);

    expect(isAiReady()).toBe(false);
  });
});
