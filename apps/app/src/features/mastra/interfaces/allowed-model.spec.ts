import type { AllowedModel } from './allowed-model';
import { isModelInAllowList } from './allowed-model';

describe('isModelInAllowList', () => {
  const allowedModels: AllowedModel[] = [
    { modelId: 'gpt-4o', isDefault: true },
    { modelId: 'o3' },
  ];

  it('returns true when the model id matches an allow-list entry', () => {
    expect(isModelInAllowList('o3', allowedModels)).toBe(true);
  });

  it('returns false when the model id is absent from the allow-list', () => {
    expect(isModelInAllowList('removed-model', allowedModels)).toBe(false);
  });

  it('returns false for an empty allow-list', () => {
    expect(isModelInAllowList('gpt-4o', [])).toBe(false);
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
    expect(isModelInAllowList(value, allowedModels)).toBe(false);
  });
});
