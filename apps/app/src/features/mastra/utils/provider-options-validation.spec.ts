import { isValidProviderOptionsJson } from './provider-options-validation';

describe('isValidProviderOptionsJson (shared FE/BE, Req 6.2)', () => {
  it.each([
    ['an empty string', ''],
    ['a whitespace-only string', '   '],
  ])('treats %s as valid ("no provider options")', (_label, value) => {
    expect(isValidProviderOptionsJson(value)).toBe(true);
  });

  it('accepts a parsable provider-namespaced JSON object', () => {
    expect(isValidProviderOptionsJson('{"openai":{"x":1}}')).toBe(true);
  });

  it('accepts a parsable JSON array', () => {
    expect(isValidProviderOptionsJson('[1,2,3]')).toBe(true);
  });

  // JSON.parse accepts bare primitives, so the shared predicate does too. This
  // is the parity point with the client: both treat these as valid.
  it.each([
    ['a bare number', '42'],
    ['a quoted string', '"x"'],
    ['the literal true', 'true'],
    ['the literal null', 'null'],
  ])('accepts %s (JSON.parse accepts it)', (_label, value) => {
    expect(isValidProviderOptionsJson(value)).toBe(true);
  });

  it('rejects a malformed JSON string', () => {
    expect(isValidProviderOptionsJson('{ bad')).toBe(false);
  });
});
