import { isLlmProvider, LLM_PROVIDERS } from './llm-provider';

describe('llm-provider', () => {
  describe('LLM_PROVIDERS', () => {
    it('enumerates exactly the three supported vendors', () => {
      expect([...LLM_PROVIDERS]).toStrictEqual([
        'openai',
        'anthropic',
        'google',
      ]);
    });
  });

  describe('isLlmProvider', () => {
    it.each([
      'openai',
      'anthropic',
      'google',
    ])('returns true for the supported provider "%s"', (provider) => {
      expect(isLlmProvider(provider)).toBe(true);
    });

    it.each([
      'azure',
      'gpt',
      'OpenAI',
      'openai ',
      '',
    ])('returns false for an unsupported string "%s"', (value) => {
      expect(isLlmProvider(value)).toBe(false);
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['a number', 123],
      ['an object', { provider: 'openai' }],
      ['an array', ['openai']],
      ['a boolean', true],
    ])('returns false for non-string input (%s)', (_label, value) => {
      expect(isLlmProvider(value)).toBe(false);
    });
  });
});
