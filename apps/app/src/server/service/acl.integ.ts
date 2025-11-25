import type { MockInstance } from 'vitest';

import { aclService } from './acl';
import { configManager } from './config-manager';

describe('AclService', () => {
  test("has consts 'isLabeledStatement'", () => {
    expect(aclService.labels.SECURITY_RESTRICT_GUEST_MODE_DENY).toBe('Deny');
    expect(aclService.labels.SECURITY_RESTRICT_GUEST_MODE_READONLY).toBe(
      'Readonly',
    );
    expect(aclService.labels.SECURITY_REGISTRATION_MODE_OPEN).toBe('Open');
    expect(aclService.labels.SECURITY_REGISTRATION_MODE_RESTRICTED).toBe(
      'Restricted',
    );
    expect(aclService.labels.SECURITY_REGISTRATION_MODE_CLOSED).toBe('Closed');
  });
});

describe('AclService test', () => {
  const initialEnv = process.env;

  beforeAll(async () => {
    await configManager.loadConfigs();
  });

  afterEach(() => {
    process.env = initialEnv;
  });

  describe('isAclEnabled()', () => {
    test('to be false when FORCE_WIKI_MODE is undefined', async () => {
      delete process.env.FORCE_WIKI_MODE;

      // reload
      await configManager.loadConfigs();

      const result = aclService.isAclEnabled();

      const wikiMode = configManager.getConfig('security:wikiMode');
      expect(wikiMode).toBe(undefined);
      expect(result).toBe(true);
    });

    test('to be false when FORCE_WIKI_MODE is dummy string', async () => {
      process.env.FORCE_WIKI_MODE = 'dummy string';

      // reload
      await configManager.loadConfigs();

      const result = aclService.isAclEnabled();

      const wikiMode = configManager.getConfig('security:wikiMode');
      expect(wikiMode).toBe('dummy string');
      expect(result).toBe(true);
    });

    test('to be true when FORCE_WIKI_MODE=private', async () => {
      process.env.FORCE_WIKI_MODE = 'private';

      // reload
      await configManager.loadConfigs();

      const result = aclService.isAclEnabled();

      const wikiMode = configManager.getConfig('security:wikiMode');
      expect(wikiMode).toBe('private');
      expect(result).toBe(true);
    });

    test('to be false when FORCE_WIKI_MODE=public', async () => {
      process.env.FORCE_WIKI_MODE = 'public';

      // reload
      await configManager.loadConfigs();

      const result = aclService.isAclEnabled();

      const wikiMode = configManager.getConfig('security:wikiMode');
      expect(wikiMode).toBe('public');
      expect(result).toBe(false);
    });
  });

  describe('isWikiModeForced()', () => {
    test('to be false when FORCE_WIKI_MODE is undefined', async () => {
      delete process.env.FORCE_WIKI_MODE;

      // reload
      await configManager.loadConfigs();

      const result = aclService.isWikiModeForced();

      const wikiMode = configManager.getConfig('security:wikiMode');
      expect(wikiMode).toBe(undefined);
      expect(result).toBe(false);
    });

    test('to be false when FORCE_WIKI_MODE is dummy string', async () => {
      process.env.FORCE_WIKI_MODE = 'dummy string';

      // reload
      await configManager.loadConfigs();

      const result = aclService.isWikiModeForced();

      const wikiMode = configManager.getConfig('security:wikiMode');
      expect(wikiMode).toBe('dummy string');
      expect(result).toBe(false);
    });

    test('to be true when FORCE_WIKI_MODE=private', async () => {
      process.env.FORCE_WIKI_MODE = 'private';

      // reload
      await configManager.loadConfigs();

      const result = aclService.isWikiModeForced();

      const wikiMode = configManager.getConfig('security:wikiMode');
      expect(wikiMode).toBe('private');
      expect(result).toBe(true);
    });

    test('to be false when FORCE_WIKI_MODE=public', async () => {
      process.env.FORCE_WIKI_MODE = 'public';

      // reload
      await configManager.loadConfigs();

      const result = aclService.isWikiModeForced();

      const wikiMode = configManager.getConfig('security:wikiMode');
      expect(wikiMode).toBe('public');
      expect(result).toBe(true);
    });
  });

  describe('isGuestAllowedToRead()', () => {
    let getConfigSpy: MockInstance<typeof configManager.getConfig>;

    beforeEach(async () => {
      // prepare spy for ConfigManager.getConfig
      getConfigSpy = vi.spyOn(configManager, 'getConfig');
    });

    test('to be false when FORCE_WIKI_MODE=private', async () => {
      process.env.FORCE_WIKI_MODE = 'private';

      // reload
      await configManager.loadConfigs();

      const result = aclService.isGuestAllowedToRead();

      const wikiMode = configManager.getConfig('security:wikiMode');
      expect(wikiMode).toBe('private');
      expect(getConfigSpy).not.toHaveBeenCalledWith(
        'security:restrictGuestMode',
      );
      expect(result).toBe(false);
    });

    test('to be true when FORCE_WIKI_MODE=public', async () => {
      process.env.FORCE_WIKI_MODE = 'public';

      // reload
      await configManager.loadConfigs();

      const result = aclService.isGuestAllowedToRead();

      const wikiMode = configManager.getConfig('security:wikiMode');
      expect(wikiMode).toBe('public');
      expect(getConfigSpy).not.toHaveBeenCalledWith(
        'security:restrictGuestMode',
      );
      expect(result).toBe(true);
    });

    /* eslint-disable indent */
    describe.each`
      restrictGuestMode | expected
      ${undefined}      | ${false}
      ${'Deny'}         | ${false}
      ${'Readonly'}     | ${true}
      ${'Open'}         | ${false}
      ${'Restricted'}   | ${false}
      ${'closed'}       | ${false}
    `('to be $expected', ({ restrictGuestMode, expected }) => {
      test(`when FORCE_WIKI_MODE is undefined and 'security:restrictGuestMode' is '${restrictGuestMode}`, async () => {
        // reload
        await configManager.loadConfigs();

        // setup mock implementation
        getConfigSpy.mockImplementation((key) => {
          if (key === 'security:restrictGuestMode') {
            return restrictGuestMode;
          }
          if (key === 'security:wikiMode') {
            return undefined;
          }
          throw new Error('Unexpected behavior.');
        });

        const result = aclService.isGuestAllowedToRead();

        expect(getConfigSpy).toHaveBeenCalledTimes(2);
        expect(getConfigSpy).toHaveBeenCalledWith('security:wikiMode');
        expect(getConfigSpy).toHaveBeenCalledWith('security:restrictGuestMode');
        expect(result).toBe(expected);
      });
    });
  });
});
