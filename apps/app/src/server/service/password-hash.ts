import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:service:password-hash');

/**
 * PasswordHashService
 *
 * Generates and verifies password hashes for GROWI local authentication.
 *
 * - New hashes use scrypt (memory-hard KDF, `node:crypto`, per-user random salt)
 *   encoded as a self-describing envelope: `scrypt$N$r$p$<salt base64>$<hash base64>`.
 * - Verification transparently supports both the scrypt envelope and the legacy
 *   `SHA-256(PASSWORD_SEED + plaintext)` hash so that existing users keep logging in
 *   during the migration period (Req 2.1–2.3).
 * - PASSWORD_SEED is NEVER used when generating a new hash (Req 1.3); it is only used
 *   on the legacy verification path.
 */

export interface VerifyResult {
  isValid: boolean;
  needsRehash: boolean;
}

/**
 * Optional identity context threaded into verify() so that anomaly WARNINGs
 * (Req 2.4 — a stored credential field present but matching no known format)
 * carry a user identifier for forensic triage. Supplied by the User model.
 */
export interface VerifyLogContext {
  userId?: string;
  username?: string;
}

export interface IPasswordHashService {
  hash(plaintext: string): Promise<string>;
  verify(
    plaintext: string,
    scryptHash: string | undefined,
    legacyHash: string | undefined,
    passwordSeed: string,
    context?: VerifyLogContext,
  ): Promise<VerifyResult>;
}

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

// Derived key length in bytes. Fixed for newly generated hashes; on verification the
// stored hash length is used so that hashes produced with any keylen still verify.
const KEYLEN = 64;

// Bounds for a STORED envelope's salt/hash byte lengths (verify path). verifyScrypt uses
// hash.length as the scrypt keylen, so it must be bounded: below HASH_MIN it weakens
// verification, above HASH_MAX it is a memory-DoS vector.
const SALT_MIN_BYTES = 8;
const HASH_MIN_BYTES = 32;
const HASH_MAX_BYTES = 1024;

// The envelope prefix / algorithm identifier.
const ALGORITHM = 'scrypt';

// OWASP minimum recommended parameters. These are the production defaults and the
// lower clamp floor for env-derived configuration.
const DEFAULT_N = 2 ** 17; // 131072
const DEFAULT_R = 8;
const DEFAULT_P = 1;

// Lower bounds (security floor). Env values below these are clamped up with a WARNING.
const N_FLOOR = DEFAULT_N;
const R_FLOOR = DEFAULT_R;
const P_FLOOR = DEFAULT_P;

// Upper bounds (DoS guard). Extreme values would exhaust memory, so they are clamped down.
const N_MAX = 2 ** 20; // 1048576
const R_MAX = 32;
const P_MAX = 16;

/**
 * Compute an explicit `maxmem` for scrypt.
 *
 * scrypt consumes roughly `128 * N * r` bytes per call. Node's default `maxmem` is 32MB,
 * which makes scrypt throw at N=2^17 (~128MB). We therefore set `maxmem` explicitly to a
 * value derived from the (possibly clamped) params with headroom, and never below 192MB.
 */
const computeMaxmem = (N: number, r: number): number =>
  Math.max(192 * 1024 * 1024, 128 * N * r * 2);

/**
 * Promise wrapper around the options overload of `crypto.scrypt`.
 *
 * `util.promisify(scrypt)` drops the options overload (TS2554), so the callback form is
 * wrapped manually to keep the `{ N, r, p, maxmem }` argument.
 */
const scryptAsync = (
  plaintext: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(plaintext, salt, keylen, options, (err, derivedKey) => {
      if (err != null) {
        reject(err);
        return;
      }
      resolve(derivedKey);
    });
  });

const isSha256Hex = (value: string): boolean => /^[0-9a-f]{64}$/.test(value);

const isPresent = (value: string | undefined): value is string =>
  value != null && value !== '';

interface ParsedScryptHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

/**
 * Parse a `scrypt$N$r$p$<salt base64>$<hash base64>` envelope.
 * Throws when the string is not a well-formed scrypt envelope (caught by verify()).
 */
const parseScryptHash = (encoded: string): ParsedScryptHash => {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== ALGORITHM) {
    throw new Error('Not a scrypt envelope');
  }

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (
    !Number.isInteger(N) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    N <= 1 ||
    r <= 0 ||
    p <= 0
  ) {
    throw new Error('Invalid scrypt parameters');
  }

  // DoS guard: a stored envelope must not drive scrypt past the upper bounds we clamp
  // configured params to. Without this, computeMaxmem() derives maxmem from the stored
  // value and defeats Node's memory guard. Reject (not clamp): an out-of-range stored
  // value is not a hash this service produced.
  if (N > N_MAX || r > R_MAX || p > P_MAX) {
    throw new Error('scrypt parameters out of bounds');
  }

  const salt = Buffer.from(parts[4], 'base64');
  const hash = Buffer.from(parts[5], 'base64');
  if (
    salt.length < SALT_MIN_BYTES ||
    hash.length < HASH_MIN_BYTES ||
    hash.length > HASH_MAX_BYTES
  ) {
    throw new Error('Invalid scrypt salt/hash');
  }

  return {
    N,
    r,
    p,
    salt,
    hash,
  };
};

/**
 * Clamp params to the DoS upper bounds only. The security floor is applied only on the
 * env-derived path (`resolveScryptParamsFromEnv`) so that callers/tests may inject
 * deliberately small params via `createPasswordHashServiceForTest`.
 */
const clampUpperBounds = (params: ScryptParams): ScryptParams => ({
  N: Math.min(params.N, N_MAX),
  r: Math.min(params.r, R_MAX),
  p: Math.min(params.p, P_MAX),
});

class PasswordHashService implements IPasswordHashService {
  private readonly params: ScryptParams;

  constructor(params: ScryptParams) {
    this.params = clampUpperBounds(params);
  }

  async hash(plaintext: string): Promise<string> {
    const { N, r, p } = this.params;
    const salt = randomBytes(16);
    const derived = await scryptAsync(plaintext, salt, KEYLEN, {
      N,
      r,
      p,
      maxmem: computeMaxmem(N, r),
    });

    return `${ALGORITHM}$${N}$${r}$${p}$${salt.toString('base64')}$${derived.toString('base64')}`;
  }

  async verify(
    plaintext: string,
    scryptHash: string | undefined,
    legacyHash: string | undefined,
    passwordSeed: string,
    context?: VerifyLogContext,
  ): Promise<VerifyResult> {
    // Guard: a nullish/empty plaintext is a bad *input*, not corrupt stored data.
    // Without this it would reach verifyScrypt where crypto.scrypt throws synchronously,
    // and the catch would mislog it as a "Malformed scrypt password hash" WARNING
    // (Req 2.4) — blaming the stored hash for a caller mistake. Reject quietly instead;
    // design.md → PasswordHashService Preconditions require a non-empty plaintext.
    if (plaintext == null || plaintext === '') {
      return { isValid: false, needsRehash: false };
    }

    if (isPresent(scryptHash)) {
      return await this.verifyScrypt(plaintext, scryptHash, context);
    }

    if (isPresent(legacyHash)) {
      return this.verifyLegacy(plaintext, legacyHash, passwordSeed, context);
    }

    // Branch 3: both absent (noPassword). Normal state for external-auth-only or
    // not-yet-activated users — reject WITHOUT a WARNING (Req 2.5).
    return { isValid: false, needsRehash: false };
  }

  private async verifyScrypt(
    plaintext: string,
    scryptHash: string,
    context?: VerifyLogContext,
  ): Promise<VerifyResult> {
    try {
      const parsed = parseScryptHash(scryptHash);
      const derived = await scryptAsync(
        plaintext,
        parsed.salt,
        parsed.hash.length,
        {
          N: parsed.N,
          r: parsed.r,
          p: parsed.p,
          maxmem: computeMaxmem(parsed.N, parsed.r),
        },
      );

      // timingSafeEqual throws on length mismatch; keylen == stored length so they match,
      // but the surrounding try/catch keeps the "never throws" invariant regardless.
      const isValid = timingSafeEqual(derived, parsed.hash);
      const needsRehash = isValid && this.isWeakerThanCurrent(parsed);
      return { isValid, needsRehash };
    } catch (err) {
      // Field is present but its content is not a usable scrypt envelope (Req 2.4).
      logger.warn(
        { error: err, userId: context?.userId, username: context?.username },
        'Malformed scrypt password hash encountered during verification',
      );
      return { isValid: false, needsRehash: false };
    }
  }

  private verifyLegacy(
    plaintext: string,
    legacyHash: string,
    passwordSeed: string,
    context?: VerifyLogContext,
  ): VerifyResult {
    try {
      if (!isSha256Hex(legacyHash)) {
        // Field is present but not a known format (Req 2.4).
        logger.warn(
          { userId: context?.userId, username: context?.username },
          'Malformed legacy password hash encountered during verification',
        );
        return { isValid: false, needsRehash: false };
      }

      const computed = createHash('sha256')
        .update(passwordSeed + plaintext)
        .digest('hex');
      const isValid = timingSafeEqual(
        Buffer.from(computed, 'hex'),
        Buffer.from(legacyHash, 'hex'),
      );

      // A successful legacy verification always triggers a rehash to scrypt (Req 2.2).
      return { isValid, needsRehash: isValid };
    } catch (err) {
      logger.warn(
        { error: err, userId: context?.userId, username: context?.username },
        'Error while verifying legacy password hash',
      );
      return { isValid: false, needsRehash: false };
    }
  }

  /**
   * Optional extension: if a stored scrypt hash uses params weaker than the service's
   * current configuration, request a rehash on the next successful login so existing
   * users automatically follow parameter upgrades (design.md → PasswordHashService).
   */
  private isWeakerThanCurrent(parsed: ParsedScryptHash): boolean {
    return (
      parsed.N < this.params.N ||
      parsed.r < this.params.r ||
      parsed.p < this.params.p
    );
  }
}

/**
 * Resolve scrypt params from the environment, applying the security floor (clamp up with
 * a startup WARNING) and the DoS upper bound (clamp down with a WARNING).
 */
export const resolveScryptParamsFromEnv = (): ScryptParams => {
  const parsePositiveInt = (raw: string | undefined): number | undefined => {
    if (raw == null || raw === '') {
      return undefined;
    }
    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : undefined;
  };

  let N = parsePositiveInt(process.env.PASSWORD_SCRYPT_N) ?? DEFAULT_N;
  let r = parsePositiveInt(process.env.PASSWORD_SCRYPT_R) ?? DEFAULT_R;
  let p = parsePositiveInt(process.env.PASSWORD_SCRYPT_P) ?? DEFAULT_P;

  // Security floor: never fall below OWASP minimum recommendations.
  if (N < N_FLOOR) {
    logger.warn(
      `PASSWORD_SCRYPT_N=${N} is below the security floor; clamping up to ${N_FLOOR}`,
    );
    N = N_FLOOR;
  }
  if (r < R_FLOOR) {
    logger.warn(
      `PASSWORD_SCRYPT_R=${r} is below the security floor; clamping up to ${R_FLOOR}`,
    );
    r = R_FLOOR;
  }
  if (p < P_FLOOR) {
    logger.warn(
      `PASSWORD_SCRYPT_P=${p} is below the security floor; clamping up to ${P_FLOOR}`,
    );
    p = P_FLOOR;
  }

  // DoS guard: clamp extreme values that would exhaust memory.
  if (N > N_MAX) {
    logger.warn(
      `PASSWORD_SCRYPT_N=${N} exceeds the upper bound; clamping down to ${N_MAX}`,
    );
    N = N_MAX;
  }
  if (r > R_MAX) {
    logger.warn(
      `PASSWORD_SCRYPT_R=${r} exceeds the upper bound; clamping down to ${R_MAX}`,
    );
    r = R_MAX;
  }
  if (p > P_MAX) {
    logger.warn(
      `PASSWORD_SCRYPT_P=${p} exceeds the upper bound; clamping down to ${P_MAX}`,
    );
    p = P_MAX;
  }

  return { N, r, p };
};

/**
 * Test-only factory for a PasswordHashService with explicit params. Used by tests to
 * inject small params so they stay fast. The security floor is NOT applied here (only the
 * DoS upper bound) — floor clamping belongs to the env-derived production singleton below,
 * so this MUST NOT be used in production code (hence the `ForTest` suffix).
 */
export const createPasswordHashServiceForTest = (
  params: ScryptParams,
): IPasswordHashService => new PasswordHashService(params);

/**
 * Default singleton bound to the environment (with floor + upper-bound clamping and
 * startup WARNINGs). This is what the User model / Passport strategy consume.
 */
export const passwordHashService: IPasswordHashService =
  new PasswordHashService(resolveScryptParamsFromEnv());
