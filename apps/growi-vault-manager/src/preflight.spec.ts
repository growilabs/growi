import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockConnect = vi.hoisted(() => vi.fn());
const mockCommand = vi.hoisted(() => vi.fn());
const mockDb = vi.hoisted(() => ({ command: mockCommand }));

vi.mock('mongoose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mongoose')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      connect: mockConnect,
      connection: { ...actual.default.connection, db: mockDb },
    },
  };
});

import { checkMongoConnection, checkRequiredEnvVars } from './preflight.js';

// ---------------------------------------------------------------------------
// checkRequiredEnvVars
// ---------------------------------------------------------------------------

describe('checkRequiredEnvVars', () => {
  describe('when all required env vars are present', () => {
    it('returns without throwing', () => {
      const env = {
        VAULT_MANAGER_INTERNAL_SECRET: 'secret',
        MONGO_URI: 'mongodb://localhost:27017/growi',
        VAULT_REPO_PATH: '/repo',
      };
      expect(() => checkRequiredEnvVars(env)).not.toThrow();
    });
  });

  describe('when one required env var is missing', () => {
    it('throws an error listing the missing variable name', () => {
      const env = {
        MONGO_URI: 'mongodb://localhost:27017/growi',
        VAULT_REPO_PATH: '/repo',
        // VAULT_MANAGER_INTERNAL_SECRET intentionally absent
      };
      expect(() => checkRequiredEnvVars(env)).toThrow(
        'VAULT_MANAGER_INTERNAL_SECRET',
      );
    });
  });

  describe('when multiple required env vars are missing', () => {
    it('throws an error listing all missing variable names', () => {
      const env: NodeJS.ProcessEnv = {};
      let error: Error | undefined;
      try {
        checkRequiredEnvVars(env);
      } catch (e) {
        error = e as Error;
      }
      expect(error).toBeDefined();
      expect(error?.message).toContain('VAULT_MANAGER_INTERNAL_SECRET');
      expect(error?.message).toContain('MONGO_URI');
      expect(error?.message).toContain('VAULT_REPO_PATH');
    });
  });

  describe('when a required env var is set to an empty string', () => {
    it('treats it as missing and throws', () => {
      const env = {
        VAULT_MANAGER_INTERNAL_SECRET: '',
        MONGO_URI: 'mongodb://localhost:27017/growi',
        VAULT_REPO_PATH: '/repo',
      };
      expect(() => checkRequiredEnvVars(env)).toThrow(
        'VAULT_MANAGER_INTERNAL_SECRET',
      );
    });
  });
});

// ---------------------------------------------------------------------------
// checkMongoConnection
// ---------------------------------------------------------------------------

describe('checkMongoConnection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('when mongoose.connect resolves and ping succeeds', () => {
    it('resolves without throwing', async () => {
      mockConnect.mockResolvedValue(undefined);
      mockCommand.mockResolvedValue({ ok: 1 });

      await expect(
        checkMongoConnection('mongodb://localhost:27017/growi', 5000),
      ).resolves.toBeUndefined();
    });
  });

  describe('when mongoose.connect rejects (connection refused)', () => {
    it('throws an error', async () => {
      mockConnect.mockRejectedValue(new Error('connect ECONNREFUSED'));

      await expect(
        checkMongoConnection('mongodb://localhost:27017/growi', 200),
      ).rejects.toThrow();
    });
  });

  describe('when connection times out', () => {
    it('throws an error mentioning the timeout duration', async () => {
      // Never resolves — simulates a hung connection
      mockConnect.mockImplementation(() => new Promise<never>(() => {}));

      await expect(
        checkMongoConnection('mongodb://localhost:27017/growi', 100),
      ).rejects.toThrow(/100/);
    });
  });
});
