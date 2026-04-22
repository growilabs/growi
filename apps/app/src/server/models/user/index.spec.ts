/**
 * Unit tests for lazy singleton getters in models/user/index.js
 *
 * Asserts:
 *   (a) Each getter returns the same object reference on multiple calls (singleton cache)
 *   (b) Each getter is a synchronous function (not async, no Promise returned)
 */

// Mock heavy dependencies to enable unit-level testing
vi.mock('mongoose', () => ({
  default: {
    Schema: class MockSchema {
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
vi.mock('^/config/next-i18next.config.cjs', () => ({
  i18n: { locales: ['en_US', 'ja_JP'] },
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

describe('models/user lazy singleton getters', () => {
  describe('getConfigManager', () => {
    it('should be a synchronous function (not return a Promise)', async () => {
      const { getConfigManager } = await import('./index');
      const result = getConfigManager();
      // Must not be a Promise
      expect(result).not.toBeInstanceOf(Promise);
      expect(typeof result).toBe('object');
    });

    it('should return the same singleton reference on multiple calls (cache is singleton)', async () => {
      const { getConfigManager } = await import('./index');
      const first = getConfigManager();
      const second = getConfigManager();
      // Must be strictly the same object (cached reference)
      expect(first).toBe(second);
    });
  });

  describe('getAclService', () => {
    it('should be a synchronous function (not return a Promise)', async () => {
      const { getAclService } = await import('./index');
      const result = getAclService();
      // Must not be a Promise
      expect(result).not.toBeInstanceOf(Promise);
      expect(typeof result).toBe('object');
    });

    it('should return the same singleton reference on multiple calls (cache is singleton)', async () => {
      const { getAclService } = await import('./index');
      const first = getAclService();
      const second = getAclService();
      // Must be strictly the same object (cached reference)
      expect(first).toBe(second);
    });
  });
});
