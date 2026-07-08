import { AI_PROVIDERS, isAiProvider } from './ai-provider';

describe('llm-provider', () => {
  describe('AI_PROVIDERS', () => {
    it('enumerates exactly the four supported vendors', () => {
      expect([...AI_PROVIDERS]).toStrictEqual([
        'openai',
        'anthropic',
        'google',
        'azure-openai',
      ]);
    });
  });

  describe('isAiProvider', () => {
    it.each([
      'openai',
      'anthropic',
      'google',
      'azure-openai',
    ])('returns true for the supported provider "%s"', (provider) => {
      expect(isAiProvider(provider)).toBe(true);
    });

    it.each([
      'cohere',
      'gpt',
      'OpenAI',
      'azure',
      'Azure-OpenAI',
      'openai ',
      '',
    ])('returns false for an unsupported string "%s"', (value) => {
      expect(isAiProvider(value)).toBe(false);
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['a number', 123],
      ['an object', { provider: 'openai' }],
      ['an array', ['openai']],
      ['a boolean', true],
    ])('returns false for non-string input (%s)', (_label, value) => {
      expect(isAiProvider(value)).toBe(false);
    });
  });
});
