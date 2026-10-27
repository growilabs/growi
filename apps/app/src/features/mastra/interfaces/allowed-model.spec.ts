import type { AllowedModel } from './allowed-model';
import { isModelInAllowList } from './allowed-model';

describe('isModelInAllowList', () => {
  const allowedModels: AllowedModel[] = [
    { provider: 'openai', modelId: 'gpt-4o', isDefault: true },
    { provider: 'openai', modelId: 'o3' },
    { provider: 'anthropic', modelId: 'claude-sonnet-4' },
  ];

  it('returns true when the (provider, modelId) pair matches an allow-list entry', () => {
    expect(isModelInAllowList('openai', 'o3', allowedModels)).toBe(true);
    expect(
      isModelInAllowList('anthropic', 'claude-sonnet-4', allowedModels),
    ).toBe(true);
  });

  it('returns false when the modelId exists but under a different provider', () => {
    // 'gpt-4o' is allowed for openai only — membership is per (provider, modelId)
    // pair, so another provider must not inherit it.
    expect(isModelInAllowList('anthropic', 'gpt-4o', allowedModels)).toBe(
      false,
    );
    expect(isModelInAllowList('google', 'gpt-4o', allowedModels)).toBe(false);
  });

  it('returns false when the provider has entries but not this modelId', () => {
    expect(isModelInAllowList('openai', 'removed-model', allowedModels)).toBe(
      false,
    );
  });

  it('returns false for an empty allow-list', () => {
    expect(isModelInAllowList('openai', 'gpt-4o', [])).toBe(false);
  });

  it('lets the same modelId coexist under different providers, each matched independently', () => {
    // Cross-provider coexistence (Req 2.3): identical model ids under two
    // providers are distinct allow-list entries.
    const coexisting: AllowedModel[] = [
      { provider: 'openai', modelId: 'shared-id', isDefault: true },
      { provider: 'azure-openai', modelId: 'shared-id' },
    ];

    expect(isModelInAllowList('openai', 'shared-id', coexisting)).toBe(true);
    expect(isModelInAllowList('azure-openai', 'shared-id', coexisting)).toBe(
      true,
    );
    expect(isModelInAllowList('anthropic', 'shared-id', coexisting)).toBe(
      false,
    );
  });

  it.each([
    'GPT-4O',
    'gpt',
    'gpt-4o-mini',
    ' gpt-4o',
  ])('matches by exact model id only, not "%s"', (value) => {
    // Membership is exact string equality — no case-folding, prefix, or
    // trimming. Documenting this is the point of centralising the rule: any
    // future change (e.g. case-insensitive ids) happens here, once.
    expect(isModelInAllowList('openai', value, allowedModels)).toBe(false);
  });
});
