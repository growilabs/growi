import { isLlmVendor, LLM_VENDORS } from './llm-vendor';

describe('llm-vendor', () => {
  describe('LLM_VENDORS', () => {
    it('enumerates exactly the three supported vendors', () => {
      expect([...LLM_VENDORS]).toStrictEqual(['openai', 'anthropic', 'google']);
    });
  });

  describe('isLlmVendor', () => {
    it.each([
      'openai',
      'anthropic',
      'google',
    ])('returns true for the supported vendor "%s"', (vendor) => {
      expect(isLlmVendor(vendor)).toBe(true);
    });

    it.each([
      'azure',
      'gpt',
      'OpenAI',
      'openai ',
      '',
    ])('returns false for an unsupported string "%s"', (value) => {
      expect(isLlmVendor(value)).toBe(false);
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['a number', 123],
      ['an object', { vendor: 'openai' }],
      ['an array', ['openai']],
      ['a boolean', true],
    ])('returns false for non-string input (%s)', (_label, value) => {
      expect(isLlmVendor(value)).toBe(false);
    });
  });
});
