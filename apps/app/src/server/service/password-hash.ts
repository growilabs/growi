import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:service:password-hash');

// Read BCRYPT_COST from environment variable, default to 12
const BCRYPT_COST: number = (() => {
  const raw = process.env.BCRYPT_COST;
  if (raw == null) return 12;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? 12 : parsed;
})();

// Warn at startup if BCRYPT_COST is below the minimum recommended value
if (BCRYPT_COST < 12) {
  logger.warn(
    `BCRYPT_COST is set to ${BCRYPT_COST}, which is below the recommended minimum of 12. ` +
      'This weakens password security. Please set BCRYPT_COST to at least 12.',
  );
}

export interface VerifyResult {
  isValid: boolean;
  needsRehash: boolean;
}

export interface IPasswordHashService {
  hash(plaintext: string): Promise<string>;
  verify(
    plaintext: string,
    bcryptHash: string | undefined,
    legacyHash: string | undefined,
    passwordSeed: string,
  ): Promise<VerifyResult>;
}

/**
 * Hash a plaintext password using bcrypt.
 * Returns a $2b$-prefixed bcrypt hash with per-user random salt.
 * Never uses SHA-256 or PASSWORD_SEED for new hashes.
 */
export const hash = async (plaintext: string): Promise<string> => {
  return bcrypt.hash(plaintext, BCRYPT_COST);
};

/**
 * Verify a plaintext password against stored hashes.
 *
 * Priority:
 *  1. If bcryptHash is present → verify with bcrypt → needsRehash: false
 *  2. If bcryptHash absent and legacyHash present → verify with SHA-256(seed+plaintext) → needsRehash: true (if valid)
 *  3. Both absent → isValid: false, needsRehash: false (WARNING logged)
 *
 * This function NEVER throws — internal errors are caught, logged as ERROR,
 * and return { isValid: false, needsRehash: false }.
 *
 * Invariant: needsRehash is true only when isValid is true.
 */
export const verify = async (
  plaintext: string,
  bcryptHash: string | undefined,
  legacyHash: string | undefined,
  passwordSeed: string,
): Promise<VerifyResult> => {
  try {
    // Path 1: bcrypt verification (modern path)
    if (bcryptHash) {
      const isValid = await bcrypt.compare(plaintext, bcryptHash);
      return { isValid, needsRehash: false };
    }

    // Path 2: legacy SHA-256 verification
    if (legacyHash) {
      const hasher = crypto.createHash('sha256');
      hasher.update(passwordSeed + plaintext);
      const computedHash = hasher.digest('hex');
      const isValid = computedHash === legacyHash;
      // needsRehash is true only when isValid is true (invariant)
      return { isValid, needsRehash: isValid };
    }

    // Path 3: no hash stored — unknown format
    logger.warn(
      'Cannot determine password format: both bcryptPassword and password fields are absent. ' +
        'Login attempt rejected.',
    );
    return { isValid: false, needsRehash: false };
  } catch (err) {
    logger.error('Error during password verification:', err);
    return { isValid: false, needsRehash: false };
  }
};
