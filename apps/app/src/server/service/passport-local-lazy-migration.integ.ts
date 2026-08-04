import { createHash } from 'node:crypto';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import type UserEvent from '~/server/events/user';
import { configManager } from '~/server/service/config-manager';
import type { S2sMessagingService } from '~/server/service/s2s-messaging/base';

// Mock the project logger so case 4 can assert that the noPassword path emits NO
// WARNING (Req 2.5). The mocked factory always returns the same logger instance,
// so the singleton logger created inside password-hash.ts (imported transitively
// by the User model) is this same spy.
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

import { verifyLocalCredentials } from './passport';

// The mocked loggerFactory always returns the same logger instance; vi.mocked()
// re-types its methods as spies (Tier-1 type-safe mocking) without a cast.
const getMockLogger = () => {
  const mockLogger = vi.mocked(loggerFactory)('growi:service:passport');
  return {
    warn: vi.mocked(mockLogger.warn),
    error: vi.mocked(mockLogger.error),
    info: vi.mocked(mockLogger.info),
  };
};

// This SEED is what the User model's isPasswordValid passes to
// PasswordHashService.verify (via crowi.env.PASSWORD_SEED). The legacy SHA-256
// fixtures below are computed with the exact same seed so they verify.
const SEED = 'testPasswordSeedForLazyMigration';

/** Reproduce the legacy credential format: SHA256(PASSWORD_SEED + plaintext) hex. */
const legacySha256 = (plaintext: string): string =>
  createHash('sha256')
    .update(SEED + plaintext)
    .digest('hex');

/** Result shape captured from the passport `done` callback. */
interface VerifyOutcome {
  err: unknown;
  // `user` is the mongoose doc on success, `false` on failure. Loosely typed,
  // matching the loosely-typed mongoose User model (as in user.integ.ts).
  user: any;
  info: { message: string } | undefined;
}

/** Promisify the passport-style `done(err, user, info)` callback. */
const runVerify = (
  User: any,
  username: string,
  password: string,
): Promise<VerifyOutcome> =>
  new Promise((resolve) => {
    verifyLocalCredentials(User, username, password, (err, user, info) => {
      resolve({ err, user: user ?? null, info });
    });
  });

describe('verifyLocalCredentials (Passport LocalStrategy login flow)', () => {
  let User: any;

  beforeAll(async () => {
    const s2sMessagingServiceMock = mock<S2sMessagingService>();
    configManager.setS2sMessagingService(s2sMessagingServiceMock);
    await configManager.loadConfigs();

    const crowiMock = mock<Crowi>({
      events: {
        user: mock<UserEvent>({
          on: vi.fn(),
        }),
      },
      env: {
        PASSWORD_SEED: SEED,
      },
    });

    const userModule = await import('../models/user');
    const userFactory = userModule.default;
    User = userFactory(crowiMock);
  });

  afterAll(async () => {
    await User.deleteMany({
      username: {
        $in: [
          'lazymig-legacy',
          'lazymig-scrypt',
          'lazymig-scrypt-wrongpw',
          'lazymig-nopassword',
        ],
      },
    });
  });

  describe('legacy SHA-256 user', () => {
    const plaintext = 'legacy-plaintext-pw';

    it('logs in AND lazily migrates the credential to a scrypt passwordHash (Req 2.1, 2.2)', async () => {
      const legacyHash = legacySha256(plaintext);
      const created = await User.create({
        name: 'Lazy Migration Legacy',
        username: 'lazymig-legacy',
        email: 'lazymig-legacy@example.com',
        lang: 'en_US',
        password: legacyHash,
      });
      // Precondition: only the legacy field is populated.
      expect(created.password).toBe(legacyHash);
      expect(created.passwordHash).toBeUndefined();

      // Isolate the lazy-migration progress INFO assertion below.
      const infoSpy = getMockLogger().info;
      infoSpy.mockClear();

      const { err, user, info } = await runVerify(
        User,
        'lazymig-legacy',
        plaintext,
      );

      // Successful login → done(null, user)
      expect(err).toBeNull();
      expect(info).toBeUndefined();
      expect(user).not.toBe(false);
      expect(user?._id?.toString()).toBe(created._id.toString());

      // Lazy migration persisted a scrypt passwordHash to the DB.
      const reread = await User.findById(created._id);
      expect(reread.passwordHash).toBeDefined();
      expect(reread.passwordHash.startsWith('scrypt$')).toBe(true);
      // The legacy SHA-256 field is preserved (downgrade safety).
      expect(reread.password).toBe(legacyHash);

      // A successful lazy migration emits a progress INFO (design "Monitoring")
      // carrying the user identifier.
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'lazymig-legacy' }),
        expect.stringContaining('rehash'),
      );
    });
  });

  describe('scrypt user', () => {
    const plaintext = 'scrypt-plaintext-pw';

    it('logs in WITHOUT re-hashing the stored passwordHash (Req 2.3)', async () => {
      const doc = new User({
        name: 'Lazy Migration Scrypt',
        username: 'lazymig-scrypt',
        email: 'lazymig-scrypt@example.com',
        lang: 'en_US',
      });
      await doc.setPassword(plaintext); // writes a scrypt passwordHash
      await doc.save();

      const before = await User.findById(doc._id);
      expect(before.passwordHash.startsWith('scrypt$')).toBe(true);
      // No legacy credential — this user is scrypt-only.
      expect(before.password == null || before.password === '').toBe(true);
      const passwordHashBefore = before.passwordHash;

      const { err, user, info } = await runVerify(
        User,
        'lazymig-scrypt',
        plaintext,
      );

      expect(err).toBeNull();
      expect(info).toBeUndefined();
      expect(user).not.toBe(false);
      expect(user?._id?.toString()).toBe(doc._id.toString());

      // needsRehash was false → no re-save → passwordHash is byte-for-byte identical.
      const after = await User.findById(doc._id);
      expect(after.passwordHash).toBe(passwordHashBefore);
    });

    it('rejects an incorrect password (401 semantics: done(null, false))', async () => {
      // Seed a dedicated scrypt user so this case does not depend on any user
      // left behind by a prior test (order-independent under --sequence.shuffle).
      const doc = new User({
        name: 'Lazy Migration Scrypt WrongPw',
        username: 'lazymig-scrypt-wrongpw',
        email: 'lazymig-scrypt-wrongpw@example.com',
        lang: 'en_US',
      });
      await doc.setPassword(plaintext); // writes a scrypt passwordHash
      await doc.save();

      const { err, user, info } = await runVerify(
        User,
        'lazymig-scrypt-wrongpw',
        'totally-wrong-password',
      );

      expect(err).toBeNull();
      expect(user).toBe(false);
      expect(info?.message).toBeTruthy();
    });
  });

  describe('noPassword user', () => {
    it('fails local login WITHOUT emitting a WARNING (Req 2.5)', async () => {
      await User.create({
        name: 'Lazy Migration NoPassword',
        username: 'lazymig-nopassword',
        email: 'lazymig-nopassword@example.com',
        lang: 'en_US',
        // neither `password` nor `passwordHash`
      });

      const warnSpy = getMockLogger().warn;
      warnSpy.mockClear();

      const { err, user, info } = await runVerify(
        User,
        'lazymig-nopassword',
        'any-password',
      );

      expect(err).toBeNull();
      expect(user).toBe(false);
      expect(info?.message).toBeTruthy();

      // noPassword is a normal state (external-auth-only / not-yet-activated
      // users) — it must NOT emit a WARNING (Req 2.5).
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
