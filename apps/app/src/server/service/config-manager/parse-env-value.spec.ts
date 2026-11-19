import { parseEnvValue } from './parse-env-value';

describe('parseEnvValue', () => {
  describe('number', () => {
    it.each([
      ['4', 4],
      ['0', 0],
      ['0.5', 0.5],
      ['2592000', 2592000],
    ])('accepts the plain decimal %s', (input, expected) => {
      expect(parseEnvValue(input, 'number')).toEqual({
        ok: true,
        value: expected,
      });
    });

    it.each([
      '0x1F',
      '1e3',
      '12abc',
      ' 12',
      '12 ',
      '-1',
      '+1',
      '.5',
      '5.',
      'Infinity',
      'NaN',
      'abc',
    ])('rejects %j', (input) => {
      expect(parseEnvValue(input, 'number').ok).toBe(false);
    });
  });

  describe('boolean', () => {
    it.each([
      ['true', true],
      ['TRUE', true],
      ['1', true],
      ['false', false],
      ['False', false],
      ['0', false],
    ])('accepts %s', (input, expected) => {
      expect(parseEnvValue(input, 'boolean')).toEqual({
        ok: true,
        value: expected,
      });
    });

    it.each([
      'yes',
      'no',
      'on',
      'ture',
      '2',
      ' true',
    ])('rejects %j', (input) => {
      expect(parseEnvValue(input, 'boolean').ok).toBe(false);
    });
  });

  describe('object', () => {
    it('parses valid JSON', () => {
      expect(parseEnvValue('{"a":[1,2]}', 'object')).toEqual({
        ok: true,
        value: { a: [1, 2] },
      });
    });

    it('rejects malformed JSON', () => {
      expect(parseEnvValue('{not json', 'object').ok).toBe(false);
    });
  });

  describe('string', () => {
    it.each(['', 'anything goes', '0x1F'])('passes %j through', (input) => {
      expect(parseEnvValue(input, 'string')).toEqual({
        ok: true,
        value: input,
      });
    });
  });
});
