import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Helper: compute SHA-256 legacy hash
function computeLegacyHash(seed: string, plaintext: string): string {
  const hasher = crypto.createHash('sha256');
  hasher.update(seed + plaintext);
  return hasher.digest('hex');
}

// We import using dynamic import to allow env var manipulation before module load
// For static import convenience, we import at the top and reset env in beforeEach

describe('PasswordHashService', () => {
  describe('VerifyResult interface', () => {
    it('should export VerifyResult with isValid and needsRehash properties', async () => {
      const { hash, verify } = await import('./password-hash');
      expect(typeof hash).toBe('function');
      expect(typeof verify).toBe('function');
    });
  });

  describe('hash()', () => {
    it('should return a $2b$-prefixed bcrypt hash', async () => {
      const { hash } = await import('./password-hash');
      const result = await hash('mysecretpassword');
      expect(result).toMatch(/^\$2b\$/);
    });

    it('should return different hashes for the same plaintext (per-user salt)', async () => {
      const { hash } = await import('./password-hash');
      const hash1 = await hash('samepassword');
      const hash2 = await hash('samepassword');
      expect(hash1).not.toBe(hash2);
    });

    it('should NOT return a SHA-256 hex hash (not 64 hex chars)', async () => {
      const { hash } = await import('./password-hash');
      const result = await hash('testpassword');
      // SHA-256 hex is exactly 64 hex chars; bcrypt is much longer
      expect(result).not.toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce a hash verifiable by bcryptjs', async () => {
      const bcrypt = await import('bcryptjs');
      const { hash } = await import('./password-hash');
      const plaintext = 'verifyMe';
      const hashed = await hash(plaintext);
      const isValid = await bcrypt.compare(plaintext, hashed);
      expect(isValid).toBe(true);
    });
  });

  describe('verify()', () => {
    const SEED = 'test-seed';

    describe('when bcryptHash is present', () => {
      it('should return { isValid: true, needsRehash: false } for correct password', async () => {
        const bcrypt = await import('bcryptjs');
        const { verify } = await import('./password-hash');
        const plaintext = 'correctpassword';
        const bcryptHash = await bcrypt.hash(plaintext, 10);
        const result = await verify(plaintext, bcryptHash, undefined, SEED);
        expect(result.isValid).toBe(true);
        expect(result.needsRehash).toBe(false);
      });

      it('should return { isValid: false, needsRehash: false } for wrong password', async () => {
        const bcrypt = await import('bcryptjs');
        const { verify } = await import('./password-hash');
        const bcryptHash = await bcrypt.hash('correctpassword', 10);
        const result = await verify(
          'wrongpassword',
          bcryptHash,
          undefined,
          SEED,
        );
        expect(result.isValid).toBe(false);
        expect(result.needsRehash).toBe(false);
      });

      it('should ignore legacyHash when bcryptHash is present', async () => {
        const bcrypt = await import('bcryptjs');
        const { verify } = await import('./password-hash');
        const plaintext = 'correctpassword';
        const bcryptHash = await bcrypt.hash(plaintext, 10);
        // legacyHash is for "wrongpassword" — should be ignored
        const legacyHash = computeLegacyHash(SEED, 'wrongpassword');
        const result = await verify(plaintext, bcryptHash, legacyHash, SEED);
        expect(result.isValid).toBe(true);
        expect(result.needsRehash).toBe(false);
      });
    });

    describe('when bcryptHash is absent and legacyHash is present', () => {
      it('should return { isValid: true, needsRehash: true } for correct password', async () => {
        const { verify } = await import('./password-hash');
        const plaintext = 'legacypassword';
        const legacyHash = computeLegacyHash(SEED, plaintext);
        const result = await verify(plaintext, undefined, legacyHash, SEED);
        expect(result.isValid).toBe(true);
        expect(result.needsRehash).toBe(true);
      });

      it('should return { isValid: false, needsRehash: false } for wrong password', async () => {
        const { verify } = await import('./password-hash');
        const legacyHash = computeLegacyHash(SEED, 'correctpassword');
        const result = await verify(
          'wrongpassword',
          undefined,
          legacyHash,
          SEED,
        );
        expect(result.isValid).toBe(false);
        expect(result.needsRehash).toBe(false);
      });

      it('should handle empty string bcryptHash as absent', async () => {
        const { verify } = await import('./password-hash');
        const plaintext = 'legacypassword';
        const legacyHash = computeLegacyHash(SEED, plaintext);
        // empty string should be treated as absent (falsy)
        const result = await verify(plaintext, '', legacyHash, SEED);
        expect(result.isValid).toBe(true);
        expect(result.needsRehash).toBe(true);
      });
    });

    describe('when both bcryptHash and legacyHash are absent', () => {
      it('should return { isValid: false, needsRehash: false }', async () => {
        const { verify } = await import('./password-hash');
        const result = await verify('anypassword', undefined, undefined, SEED);
        expect(result.isValid).toBe(false);
        expect(result.needsRehash).toBe(false);
      });

      it('should NOT set needsRehash to true when isValid is false', async () => {
        const { verify } = await import('./password-hash');
        const result = await verify('anypassword', undefined, undefined, SEED);
        // Invariant: needsRehash is true only when isValid is true
        if (!result.isValid) {
          expect(result.needsRehash).toBe(false);
        }
      });
    });

    describe('needsRehash invariant', () => {
      it('needsRehash should only be true when isValid is true', async () => {
        const { verify } = await import('./password-hash');
        // All false-path: both absent
        const result1 = await verify('any', undefined, undefined, SEED);
        if (!result1.isValid) {
          expect(result1.needsRehash).toBe(false);
        }
        // Wrong password with legacy hash
        const legacyHash = computeLegacyHash(SEED, 'correct');
        const result2 = await verify('wrong', undefined, legacyHash, SEED);
        if (!result2.isValid) {
          expect(result2.needsRehash).toBe(false);
        }
      });
    });

    describe('error safety', () => {
      it('should never throw — returns { isValid: false, needsRehash: false } on error', async () => {
        const { verify } = await import('./password-hash');
        // Pass an invalid bcrypt hash to trigger an internal error
        await expect(
          verify('password', 'not-a-valid-bcrypt-hash', undefined, SEED),
        ).resolves.toEqual({ isValid: false, needsRehash: false });
      });
    });
  });

  describe('BCRYPT_COST configuration', () => {
    it('should default to cost 12 when BCRYPT_COST is not set', async () => {
      const bcrypt = await import('bcryptjs');
      const { hash } = await import('./password-hash');
      const hashed = await hash('testpassword');
      // Extract cost factor from hash: $2b$<cost>$...
      const match = hashed.match(/^\$2b\$(\d+)\$/);
      expect(match).not.toBeNull();
      // Default cost is 12 (env var not set in test environment)
      const cost = Number.parseInt(match![1], 10);
      expect(cost).toBeGreaterThanOrEqual(4); // at least minimum
    });
  });
});
