import { AI_PROVIDERS } from './ai-provider';
import { buildModelKey, parseModelKey } from './model-key';

describe('buildModelKey', () => {
  it.each(
    AI_PROVIDERS,
  )('joins provider "%s" and modelId with a single "/"', (provider) => {
    expect(buildModelKey(provider, 'some-model')).toBe(
      `${provider}/some-model`,
    );
  });
});

describe('parseModelKey', () => {
  describe('round-trip invariant', () => {
    it.each(
      AI_PROVIDERS,
    )('parseModelKey(buildModelKey("%s", id)) returns the original pair', (provider) => {
      const modelId = 'gpt-4o-mini';

      expect(parseModelKey(buildModelKey(provider, modelId))).toEqual({
        provider,
        modelId,
      });
    });

    it('round-trips a modelId that itself contains separators', () => {
      const provider = 'openai';
      const modelId = 'ft:gpt-4o/org/custom-suffix';

      expect(parseModelKey(buildModelKey(provider, modelId))).toEqual({
        provider,
        modelId,
      });
    });
  });

  describe('separator handling', () => {
    it('splits at the first "/" only, keeping later "/" as part of modelId', () => {
      expect(parseModelKey('anthropic/claude/3/opus')).toEqual({
        provider: 'anthropic',
        modelId: 'claude/3/opus',
      });
    });
  });

  describe('invalid inputs', () => {
    it.each([
      ['no separator', 'openai'],
      ['empty string', ''],
      ['empty modelId part', 'openai/'],
      ['unknown provider prefix', 'unknown-provider/gpt-4o'],
      ['case-mismatched provider prefix', 'OpenAI/gpt-4o'],
      ['empty provider prefix', '/gpt-4o'],
      ['separator only', '/'],
    ])('returns null for %s', (_label, key) => {
      expect(parseModelKey(key)).toBeNull();
    });
  });
});
