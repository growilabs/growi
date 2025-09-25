import { toBoolean } from './env-utils';

describe('env-utils', () => {
  describe('.toBoolean', () => {
    it('should convert to true', () => {
      expect(toBoolean('true')).toBe(true);
      expect(toBoolean('True')).toBe(true);
      expect(toBoolean('1')).toBe(true);
    });

    it('should convert to false', () => {
      // expect(toBoolean(undefined)).toBe(false);
      // expect(toBoolean(null)).toBe(false);
      expect(toBoolean('false')).toBe(false);
      expect(toBoolean('0')).toBe(false);
    });
  });
});
