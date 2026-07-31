import { createHash } from 'node:crypto';
import { describe, expect, it, type MockInstance, vi } from 'vitest';

// Mock the project logger so we can assert WARNING emission (Req 2.4 / 2.5).
vi.mock('~/utils/logger', () => {
  const mockLogger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  return {
    default: vi.fn().mockReturnValue(mockLogger),
  };
});

import loggerFactory from '~/utils/logger';

import { createPasswordHashService } from './password-hash';

// The mocked loggerFactory always returns the same logger instance.
const getMockLogger = () =>
  (
    loggerFactory as unknown as () => {
      warn: MockInstance;
      error: MockInstance;
      info: MockInstance;
    }
  )();

// Use a deliberately small N so tests stay fast; production default is 2^17.
const TEST_PARAMS = { N: 2 ** 14, r: 8, p: 1 };
const SEED = 'test-password-seed';

const sha256Legacy = (plaintext: string, seed: string): string =>
  createHash('sha256')
    .update(seed + plaintext)
    .digest('hex');

describe('PasswordHashService', () => {
  const service = createPasswordHashService(TEST_PARAMS);

  describe('hash()', () => {
    it('returns a self-describing scrypt$ envelope, not a 64-char SHA-256 hex', async () => {
      const hashed = await service.hash('s3cr3t');

      expect(hashed.startsWith('scrypt$')).toBe(true);
      expect(hashed).not.toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces different hashes for the same plaintext (per-user salt)', async () => {
      const [a, b] = await Promise.all([
        service.hash('same-password'),
        service.hash('same-password'),
      ]);

      expect(a).not.toBe(b);
    });
  });

  describe('verify() - scrypt path', () => {
    it('returns { isValid: true, needsRehash: false } for a correct password', async () => {
      const hashed = await service.hash('correct-horse');

      const result = await service.verify(
        'correct-horse',
        hashed,
        undefined,
        SEED,
      );

      expect(result).toEqual({ isValid: true, needsRehash: false });
    });

    it('returns isValid: false for a wrong password', async () => {
      const hashed = await service.hash('correct-horse');

      const result = await service.verify(
        'battery-staple',
        hashed,
        undefined,
        SEED,
      );

      expect(result.isValid).toBe(false);
    });

    it('returns needsRehash: true when the stored params are weaker than the current defaults', async () => {
      const weakService = createPasswordHashService({ N: 2 ** 13, r: 8, p: 1 });
      const weakHash = await weakService.hash('legacy-params');

      // `service` is configured with a stronger N (2^14 > 2^13).
      const result = await service.verify(
        'legacy-params',
        weakHash,
        undefined,
        SEED,
      );

      expect(result).toEqual({ isValid: true, needsRehash: true });
    });
  });

  describe('verify() - legacy SHA-256 path', () => {
    it('returns { isValid: true, needsRehash: true } for a correct legacy password', async () => {
      const legacy = sha256Legacy('old-password', SEED);

      const result = await service.verify(
        'old-password',
        undefined,
        legacy,
        SEED,
      );

      expect(result).toEqual({ isValid: true, needsRehash: true });
    });

    it('returns isValid: false for a wrong legacy password', async () => {
      const legacy = sha256Legacy('old-password', SEED);

      const result = await service.verify(
        'wrong-password',
        undefined,
        legacy,
        SEED,
      );

      expect(result.isValid).toBe(false);
    });
  });

  describe('verify() - noPassword (both fields absent, normal state)', () => {
    it('returns { isValid: false, needsRehash: false } and does NOT warn (Req 2.5)', async () => {
      const result = await service.verify(
        'anything',
        undefined,
        undefined,
        SEED,
      );

      expect(result).toEqual({ isValid: false, needsRehash: false });
      expect(getMockLogger().warn).not.toHaveBeenCalled();
    });

    it('treats empty strings as absent and does NOT warn', async () => {
      const result = await service.verify('anything', '', '', SEED);

      expect(result).toEqual({ isValid: false, needsRehash: false });
      expect(getMockLogger().warn).not.toHaveBeenCalled();
    });
  });

  describe('verify() - malformed field (anomaly, Req 2.4)', () => {
    it('warns and rejects when the scrypt field is not a valid envelope', async () => {
      const result = await service.verify(
        'anything',
        'this-is-not-a-scrypt-envelope',
        undefined,
        SEED,
      );

      expect(result).toEqual({ isValid: false, needsRehash: false });
      expect(getMockLogger().warn).toHaveBeenCalled();
    });

    it('warns and rejects when the legacy field is not a SHA-256 hex string', async () => {
      const result = await service.verify(
        'anything',
        undefined,
        'ZZZZ-not-hex-and-wrong-length',
        SEED,
      );

      expect(result).toEqual({ isValid: false, needsRehash: false });
      expect(getMockLogger().warn).toHaveBeenCalled();
    });

    it('never throws even when the stored scrypt envelope is corrupt', async () => {
      // Well-formed prefix but garbage params/segments.
      const corrupt = 'scrypt$abc$8$1$@@@@$@@@@';

      await expect(
        service.verify('anything', corrupt, undefined, SEED),
      ).resolves.toEqual({ isValid: false, needsRehash: false });
      expect(getMockLogger().warn).toHaveBeenCalled();
    });

    it('rejects (without invoking scrypt) a stored envelope whose N exceeds the upper bound', async () => {
      // DoS guard: an attacker-planted envelope with N=2^21 (> N_MAX 2^20) must be
      // rejected at parse time, BEFORE scrypt is asked to allocate ~128*N*r bytes.
      const stored = await service.hash('pw');
      const tampered = stored.replace(/^scrypt\$\d+/, 'scrypt$2097152');

      const result = await service.verify('pw', tampered, undefined, SEED);

      expect(result).toEqual({ isValid: false, needsRehash: false });
      expect(getMockLogger().warn).toHaveBeenCalled();
    });

    it('rejects a stored envelope whose r exceeds the upper bound', async () => {
      const stored = await service.hash('pw');
      // Replace only the r segment (2nd numeric field) with a value > R_MAX (32).
      const tampered = stored.replace(/^scrypt\$(\d+)\$\d+/, 'scrypt$$$1$$64');

      const result = await service.verify('pw', tampered, undefined, SEED);

      expect(result).toEqual({ isValid: false, needsRehash: false });
      expect(getMockLogger().warn).toHaveBeenCalled();
    });

    it('rejects a stored envelope whose p exceeds the upper bound', async () => {
      const stored = await service.hash('pw');
      // Replace only the p segment (3rd numeric field) with a value > P_MAX (16).
      const tampered = stored.replace(
        /^scrypt\$(\d+)\$(\d+)\$\d+/,
        'scrypt$$$1$$$2$$32',
      );

      const result = await service.verify('pw', tampered, undefined, SEED);

      expect(result).toEqual({ isValid: false, needsRehash: false });
      expect(getMockLogger().warn).toHaveBeenCalled();
    });

    it('rejects a stored envelope whose hash segment is shorter than the minimum keylen', async () => {
      // verifyScrypt uses hash.length as the scrypt keylen; a <32-byte hash weakens
      // verification and must be rejected. Header is valid; only the hash is too short.
      const salt = Buffer.from('0123456789abcdef').toString('base64');
      const shortHash = Buffer.from('shorthash').toString('base64'); // 9 bytes < 32
      const tooShort = `scrypt$16384$8$1$${salt}$${shortHash}`;

      const result = await service.verify('pw', tooShort, undefined, SEED);

      expect(result).toEqual({ isValid: false, needsRehash: false });
      expect(getMockLogger().warn).toHaveBeenCalled();
    });
  });
});
