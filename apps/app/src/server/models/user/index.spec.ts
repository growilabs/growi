/**
 * Unit tests for lazy singleton getters in models/user/index.js
 *
 * Asserts:
 *   (a) Each getter returns the same object reference on multiple calls (singleton cache)
 *   (b) Each getter is a synchronous function (not async, no Promise returned)
 */

import { mockDeep } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';

// Mock heavy dependencies to enable unit-level testing
vi.mock('mongoose', () => ({
  default: {
    Schema: class MockSchema {
      static Types = { ObjectId: class {} };
      plugin() {
        return this;
      }
      methods: Record<string, unknown> = {};
      statics: Record<string, unknown> = {};
      virtual() {
        return { get: vi.fn() };
      }
    },
    model: vi.fn(),
    Types: { ObjectId: class {} },
  },
}));
vi.mock('mongoose-paginate-v2', () => ({ default: vi.fn() }));
vi.mock('mongoose-unique-validator', () => ({ default: vi.fn() }));
vi.mock('@growi/core/dist/models/serializers', () => ({
  omitInsecureAttributes: vi.fn((v) => v),
}));
vi.mock('@growi/core/dist/utils', () => ({
  pagePathUtils: { getUsernameByPath: vi.fn() },
}));
vi.mock('^/config/next-i18next.config.mjs', () => ({
  default: { i18n: { locales: ['en_US', 'ja_JP'] } },
}));
vi.mock('~/utils/gravatar', () => ({ generateGravatarSrc: vi.fn() }));
vi.mock('~/utils/logger', () => ({
  default: vi.fn(() => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn() })),
}));
vi.mock('../../util/mongoose-utils', () => ({
  getModelSafely: vi.fn(() => null),
}));
vi.mock('../attachment', () => ({ Attachment: { findById: vi.fn() } }));

// Provide mock singletons for the lazy-loaded services
const mockConfigManager = { getConfig: vi.fn() };
const mockAclService = {
  labels: {},
  isAclEnabled: vi.fn(),
  isGuestAllowedToRead: vi.fn(),
};

vi.mock('../../service/config-manager', () => ({
  configManager: mockConfigManager,
}));
vi.mock('../../service/acl', () => ({
  aclService: mockAclService,
}));

// PasswordHashService singleton is mocked so the password methods can be tested
// as thin delegators without running scrypt. Its contract is covered by
// password-hash.spec.ts.
const mockPasswordHashService = {
  hash: vi.fn(),
  verify: vi.fn(),
};
vi.mock('~/server/service/password-hash', () => ({
  passwordHashService: mockPasswordHashService,
}));

describe('models/user lazy singleton getters', () => {
  describe('getConfigManager', () => {
    it('should be a synchronous function (not return a Promise)', async () => {
      const { getConfigManager } = await import('.');
      const result = getConfigManager();
      // Must not be a Promise
      expect(result).not.toBeInstanceOf(Promise);
      expect(typeof result).toBe('object');
    });

    it('should return the same singleton reference on multiple calls (cache is singleton)', async () => {
      const { getConfigManager } = await import('.');
      const first = getConfigManager();
      const second = getConfigManager();
      // Must be strictly the same object (cached reference)
      expect(first).toBe(second);
    });
  });

  describe('getAclService', () => {
    it('should be a synchronous function (not return a Promise)', async () => {
      const { getAclService } = await import('.');
      const result = getAclService();
      // Must not be a Promise
      expect(result).not.toBeInstanceOf(Promise);
      expect(typeof result).toBe('object');
    });

    it('should return the same singleton reference on multiple calls (cache is singleton)', async () => {
      const { getAclService } = await import('.');
      const first = getAclService();
      const second = getAclService();
      // Must be strictly the same object (cached reference)
      expect(first).toBe(second);
    });
  });

  describe('userSchema.methods.isPasswordSet', () => {
    // Build the schema through the factory (crowi=null path skips event wiring)
    // and grab the schema instance passed to the mocked mongoose.model(), so we
    // can invoke the instance method against a plain `this` without a DB/crowi
    // bootstrap.
    const buildIsPasswordSet = async () => {
      const mongoose = (await import('mongoose')).default;
      const userModule = await import('.');
      userModule.default(null);
      const modelMock = vi.mocked(mongoose.model);
      const userSchema = modelMock.mock.calls[0][1] as unknown as {
        methods: { isPasswordSet: (this: unknown) => boolean };
      };
      return userSchema.methods.isPasswordSet;
    };

    it('should return true when passwordHash is set', async () => {
      const isPasswordSet = await buildIsPasswordSet();
      expect(isPasswordSet.call({ passwordHash: 'x' })).toBe(true);
    });

    it('should return true when legacy password is set', async () => {
      const isPasswordSet = await buildIsPasswordSet();
      expect(isPasswordSet.call({ password: 'y' })).toBe(true);
    });

    it('should return false when neither passwordHash nor password is set', async () => {
      const isPasswordSet = await buildIsPasswordSet();
      expect(isPasswordSet.call({})).toBe(false);
    });
  });
});

describe('models/user password methods (PasswordHashService delegation)', () => {
  const SEED = 'test-password-seed';

  // Build the schema through the factory with a Crowi whose env carries the
  // legacy PASSWORD_SEED, then grab the schema instance passed to the mocked
  // mongoose.model() so instance methods can be invoked against a plain `this`.
  const buildMethods = async () => {
    const crowi = mockDeep<Crowi>();
    // Set the property rather than replacing the deep-mock proxy object (which is
    // typed ProcessEnv & DeepMockProxy and rejects a plain-object assignment).
    crowi.env.PASSWORD_SEED = SEED;

    const mongoose = (await import('mongoose')).default;
    const userModule = await import('.');
    userModule.default(crowi);

    const modelMock = vi.mocked(mongoose.model);
    const userSchema = modelMock.mock.calls.at(-1)?.[1] as unknown as {
      methods: Record<
        string,
        (this: Record<string, unknown>, ...args: unknown[]) => unknown
      >;
    };
    return userSchema.methods;
  };

  beforeEach(() => {
    mockPasswordHashService.hash.mockReset();
    mockPasswordHashService.verify.mockReset();
  });

  describe('setPassword', () => {
    it('should set passwordHash to the scrypt hash and RETIRE the legacy password', async () => {
      mockPasswordHashService.hash.mockResolvedValue('scrypt$mock$hash');
      const { setPassword } = await buildMethods();

      const doc: Record<string, unknown> = { password: 'legacy-sha256' };
      const returned = await setPassword.call(doc, 'my-plaintext');

      // Delegates hashing to the service with the raw plaintext
      expect(mockPasswordHashService.hash).toHaveBeenCalledWith('my-plaintext');
      expect(doc.passwordHash).toBe('scrypt$mock$hash');
      // The old SHA-256 hash of the REPLACED password is retired (undefined →
      // $unset on save): leaving it would keep the old password valid on a
      // downgraded build after a password change / admin reset.
      expect(doc.password).toBeUndefined();
      // Returns the document itself
      expect(returned).toBe(doc);
    });

    it('should keep the legacy password when keepLegacyHash is set (lazy migration re-hashes the SAME password)', async () => {
      mockPasswordHashService.hash.mockResolvedValue('scrypt$mock$hash');
      const { setPassword } = await buildMethods();

      const doc: Record<string, unknown> = { password: 'legacy-sha256' };
      await setPassword.call(doc, 'my-plaintext', { keepLegacyHash: true });

      expect(doc.passwordHash).toBe('scrypt$mock$hash');
      // Nothing is retired here — the same credential is only re-hashed, so the
      // legacy field stays for downgrade safety (the `both` state).
      expect(doc.password).toBe('legacy-sha256');
    });
  });

  describe('isPasswordValid', () => {
    it('should delegate to PasswordHashService.verify and return its VerifyResult', async () => {
      const verifyResult = { isValid: true, needsRehash: true };
      mockPasswordHashService.verify.mockResolvedValue(verifyResult);
      const { isPasswordValid } = await buildMethods();

      const doc: Record<string, unknown> = {
        _id: 'user-object-id',
        username: 'alice',
        passwordHash: 'scrypt$stored$hash',
        password: 'legacy-sha256',
      };
      const result = await isPasswordValid.call(doc, 'my-plaintext');

      // Passes plaintext, both stored fields, the legacy SEED, and the identity
      // context (Req 2.4 — anomaly WARNINGs must carry a user identifier).
      expect(mockPasswordHashService.verify).toHaveBeenCalledWith(
        'my-plaintext',
        'scrypt$stored$hash',
        'legacy-sha256',
        SEED,
        { userId: 'user-object-id', username: 'alice' },
      );
      // Returns the service's VerifyResult verbatim (not a boolean)
      expect(result).toBe(verifyResult);
    });
  });
});
