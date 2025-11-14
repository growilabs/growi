import packageJson from '^/package.json';

const { getInstance } = require('../setup-crowi');

describe('Test for Crowi application context', () => {
  describe('construction', () => {
    test('initialize crowi context', async () => {
      const crowi = await getInstance();
      expect(crowi.version).toBe(packageJson.version);
      expect(typeof crowi.env).toBe('object');
    });

    test('config getter, setter', async () => {
      const crowi = await getInstance();
      expect(crowi.getConfig()).toEqual({});
      crowi.setConfig({ test: 1 });
      expect(crowi.getConfig()).toEqual({ test: 1 });
    });
  });
});
