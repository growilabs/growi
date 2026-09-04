import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

import {
  createPasswordHashServiceForTest,
  resolveScryptParamsFromEnv,
} from './password-hash';

// The mocked loggerFactory always returns the same logger instance; vi.mocked()
// re-types its methods as spies (Tier-1 type-safe mocking) without a cast.
const getMockLogger = () => {
  const mockLogger = vi.mocked(loggerFactory)('growi:service:password-hash');
  return {
    warn: vi.mocked(mockLogger.warn),
    error: vi.mocked(mockLogger.error),
    info: vi.mocked(mockLogger.info),
  };
};

// Use a deliberately small N so tests stay fast; production default is 2^17.
const TEST_PARAMS = { N: 2 ** 14, r: 8, p: 1 };
const SEED = 'test-password-seed';

const sha256Legacy = (plaintext: string, seed: string): string =>
  createHash('sha256')
    .update(seed + plaintext)
    .digest('hex');

describe('PasswordHashService', () => {
  const service = createPasswordHashServiceForTest(TEST_PARAMS);

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
      const weakService = createPasswordHashServiceForTest({
        N: 2 ** 13,
        r: 8,
        p: 1,
      });
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

  describe('verify() - empty/nullish plaintext (bad input, not corrupt data)', () => {
    it('returns { isValid: false, needsRehash: false } and does NOT warn for an empty plaintext, short-circuiting before the stored hash is parsed', async () => {
      // Use a MALFORMED stored hash on purpose: if the empty-plaintext guard did NOT
      // short-circuit, verifyScrypt would parse this and emit a Req 2.4 WARNING. The
      // guard must return BEFORE touching the stored hash — this pins the `=== ''`
      // branch (a valid hash here would pass even without the guard, since scrypt('')
      // does not throw).
      const malformedHash = 'not-a-scrypt-hash';
      const result = await service.verify('', malformedHash, undefined, SEED);

      expect(result).toEqual({ isValid: false, needsRehash: false });
      // An empty input is a caller mistake, not malformed stored data (no Req 2.4 WARNING).
      expect(getMockLogger().warn).not.toHaveBeenCalled();
    });

    it('returns { isValid: false, needsRehash: false } and does NOT warn for a nullish plaintext', async () => {
      const hashed = await service.hash('correct-horse');

      const result = await service.verify(
        undefined as unknown as string,
        hashed,
        undefined,
        SEED,
      );

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

  describe('verify() - a present passwordHash is never fallen back on', () => {
    // Rejecting outright instead of retrying the legacy hash is a deliberate
    // decision, not an oversight — rationale and accepted cost live in design.md
    // ("Deliberately no fallback to the legacy path"). Pinned here because a
    // reintroduced fallback is silent: both cases supply a CORRECT legacy hash
    // and the CORRECT plaintext, so only the absence of a fallback keeps them red.

    it('rejects a correct password when the scrypt envelope is malformed, even though the legacy hash matches', async () => {
      const plaintext = 'correct-horse-battery-staple';
      const validLegacy = sha256Legacy(plaintext, SEED);

      const result = await service.verify(
        plaintext,
        'this-is-not-a-scrypt-envelope',
        validLegacy,
        SEED,
      );

      expect(result).toEqual({ isValid: false, needsRehash: false });
    });

    it('rejects a wrong password against a well-formed scrypt envelope without consulting the legacy hash', async () => {
      // The scrypt hash is for a DIFFERENT password; the legacy hash matches the
      // supplied one. Only a fallback could make this succeed.
      const scryptHash = await service.hash('the-real-scrypt-password');
      const plaintext = 'the-old-legacy-password';
      const validLegacy = sha256Legacy(plaintext, SEED);

      const result = await service.verify(
        plaintext,
        scryptHash,
        validLegacy,
        SEED,
      );

      expect(result).toEqual({ isValid: false, needsRehash: false });
    });
  });

  describe('verify() - anomaly WARNING carries user identifier (Req 2.4)', () => {
    const context = { userId: 'u123', username: 'alice' };

    it('includes the user identifier in the malformed-scrypt WARNING', async () => {
      const result = await service.verify(
        'anything',
        'this-is-not-a-scrypt-envelope',
        undefined,
        SEED,
        context,
      );

      expect(result).toEqual({ isValid: false, needsRehash: false });
      // Structured, object-first payload whose userId is the supplied identifier.
      expect(getMockLogger().warn).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u123' }),
        expect.any(String),
      );
    });

    it('includes the user identifier in the malformed-legacy WARNING (structured object-first)', async () => {
      const result = await service.verify(
        'anything',
        undefined,
        'ZZZZ-not-hex-and-wrong-length',
        SEED,
        context,
      );

      expect(result).toEqual({ isValid: false, needsRehash: false });
      expect(getMockLogger().warn).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u123' }),
        expect.any(String),
      );
    });

    it('does NOT warn on the noPassword path even when a context is supplied (Req 2.5)', async () => {
      const result = await service.verify(
        'anything',
        undefined,
        undefined,
        SEED,
        context,
      );

      expect(result).toEqual({ isValid: false, needsRehash: false });
      expect(getMockLogger().warn).not.toHaveBeenCalled();
    });
  });
});

describe('resolveScryptParamsFromEnv() — env-derived params (startup clamping)', () => {
  afterEach(() => {
    // Fully restore process.env so later tests / the module singleton are unaffected.
    vi.unstubAllEnvs();
  });

  it('returns the OWASP production defaults and does NOT warn when no env override is set', () => {
    vi.stubEnv('PASSWORD_SCRYPT_N', '');
    vi.stubEnv('PASSWORD_SCRYPT_R', '');
    vi.stubEnv('PASSWORD_SCRYPT_P', '');

    const params = resolveScryptParamsFromEnv();

    expect(params).toEqual({ N: 2 ** 17, r: 8, p: 1 });
    expect(getMockLogger().warn).not.toHaveBeenCalled();
  });

  it('clamps N UP to the security floor and warns when PASSWORD_SCRYPT_N is below it', () => {
    vi.stubEnv('PASSWORD_SCRYPT_N', '1024');

    const params = resolveScryptParamsFromEnv();

    expect(params.N).toBe(2 ** 17);
    expect(getMockLogger().warn).toHaveBeenCalled();
  });

  it('clamps N DOWN to the DoS upper bound (N_MAX) and warns when PASSWORD_SCRYPT_N exceeds it', () => {
    vi.stubEnv('PASSWORD_SCRYPT_N', String(2 ** 22));

    const params = resolveScryptParamsFromEnv();

    expect(params.N).toBe(2 ** 20);
    expect(getMockLogger().warn).toHaveBeenCalled();
  });

  it('clamps r UP to the security floor and warns when PASSWORD_SCRYPT_R is below it', () => {
    vi.stubEnv('PASSWORD_SCRYPT_R', '4');

    const params = resolveScryptParamsFromEnv();

    expect(params.r).toBe(8);
    expect(getMockLogger().warn).toHaveBeenCalled();
  });

  it('clamps p DOWN to the DoS upper bound (P_MAX) and warns when PASSWORD_SCRYPT_P exceeds it', () => {
    vi.stubEnv('PASSWORD_SCRYPT_P', '32');

    const params = resolveScryptParamsFromEnv();

    expect(params.p).toBe(16);
    expect(getMockLogger().warn).toHaveBeenCalled();
  });
});
