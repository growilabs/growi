/**
 * Integration test for the password-hash downgrade-prep standalone script.
 *
 * Contract under test (implementation-agnostic — asserts observable behavior):
 *  - report-only default (SEND_RESET_EMAILS unset, Req 4.1): runDowngradePrep()
 *    counts `upgradedOnly` users (passwordHash only, no password — the users who
 *    would be LOCKED OUT after a downgrade) and makes NO DB change and sends
 *    nothing;
 *  - send mode (Req 4.2, 4.3): for each ACTIVE upgradedOnly user it invokes the
 *    injected sender (which creates the PasswordResetOrder + sends the reset
 *    email) and, ONLY after the send SUCCEEDS, `$unset`s that user's
 *    `passwordHash` field (field removal — NOT null); a user whose send FAILS
 *    keeps its passwordHash so a re-run retries it;
 *  - a NON-ACTIVE upgradedOnly user is only COUNTED (upgradedOnlyNonActive), never
 *    emailed and never $unset: forgot-password rejects non-active users on both
 *    POST and PUT, so unsetting their passwordHash would be a permanent lockout
 *    with no recovery path;
 *  - `$unset` (not null) regression (Req 4.3): an unset user is re-classified as
 *    `noPassword` and no longer counts as `upgradedOnly`, so a re-run neither
 *    double-counts nor double-emails them;
 *  - password-reset unavailable: send mode REFUSES to run (no email, no write)
 *    because the reset links it hands out would 404, leaving the $unset users
 *    with neither a credential nor a recovery path.
 *
 * Fixtures are seeded via the raw driver (not the Mongoose User model) with
 * precisely-set fields, matching the cleanup / status-migration integ tests.
 * A fake sender is injected, so this test needs NO Crowi bootstrap and NO SMTP.
 *
 * Requires a real MongoDB connection (wired by vitest.workspace.mts integ setup).
 */
import type { Collection, Document, WithId } from 'mongodb';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';

import { UserStatus } from '../models/user/conts';

const MARKER = 'pwhash-downgrade-test';
// Scope every count/find/write to this test's marker-seeded fixtures so the run
// never touches the `users` collection shared with other integ tests.
const markerFilter = { username: { $regex: `^${MARKER}` } };

type RunDowngradePrep =
  typeof import('./password-hash-downgrade-prep').runDowngradePrep;

const isUpgradedOnly = {
  passwordHash: { $exists: true },
  password: { $exists: false },
};

describe('password-hash downgrade-prep script', () => {
  let collection: Collection;
  let runDowngradePrep: RunDowngradePrep;

  beforeAll(async () => {
    ({ runDowngradePrep } = await import('./password-hash-downgrade-prep'));
    collection = mongoose.connection.collection('users');
    // Transforming this module's import graph can exceed the 10s default when the
    // whole suite runs in parallel on a cold cache.
  }, 60_000);

  // Shared per-worker collection: clear leftovers before seeding too.
  beforeEach(async () => {
    await collection.deleteMany({ username: { $regex: `^${MARKER}` } });
  });

  afterEach(async () => {
    await collection.deleteMany({ username: { $regex: `^${MARKER}` } });
  });

  afterAll(async () => {
    await collection.deleteMany({ username: { $regex: `^${MARKER}` } });
  });

  describe('report-only default: SEND_RESET_EMAILS unset (Req 4.1)', () => {
    it('counts upgradedOnly users, sends nothing, and modifies no document', async () => {
      const upgradedOnlyCount = 3;
      const docs: Record<string, unknown>[] = [];
      // upgradedOnly + ACTIVE: passwordHash only (would be locked out after downgrade)
      for (let i = 0; i < upgradedOnlyCount; i++) {
        docs.push({
          _id: new ObjectId(),
          username: `${MARKER}-upgraded-${i}`,
          email: `${MARKER}-upgraded-${i}@example.com`,
          status: UserStatus.STATUS_ACTIVE,
          passwordHash: `scrypt$hash-${i}`,
        });
      }
      // upgradedOnly + NON-ACTIVE: reported separately, never emailed
      docs.push({
        _id: new ObjectId(),
        username: `${MARKER}-upgraded-invited`,
        email: `${MARKER}-upgraded-invited@example.com`,
        status: UserStatus.STATUS_INVITED,
        passwordHash: 'scrypt$hash-invited',
      });
      // other categories that must NOT be counted or touched
      docs.push({
        _id: new ObjectId(),
        username: `${MARKER}-both-0`,
        status: UserStatus.STATUS_ACTIVE,
        passwordHash: 'scrypt$hash',
        password: 'legacy-sha256',
      });
      docs.push({
        _id: new ObjectId(),
        username: `${MARKER}-legacy-0`,
        status: UserStatus.STATUS_ACTIVE,
        password: 'legacy-sha256',
      });
      docs.push({
        _id: new ObjectId(),
        username: `${MARKER}-nopass-0`,
        status: UserStatus.STATUS_ACTIVE,
      });
      await collection.insertMany(docs);

      const before = await collection
        .find(markerFilter)
        .sort({ _id: 1 })
        .toArray();

      const sendResetEmailForUser = vi.fn(
        (_user: WithId<Document>): Promise<void> => Promise.resolve(),
      );

      const result = await runDowngradePrep({
        usersCollection: collection,
        sendResetEmailForUser,
        sendResetEmails: false,
        isPasswordResetAvailable: true,
        baseFilter: markerFilter,
      });

      expect(result.upgradedOnly).toBe(upgradedOnlyCount);
      // the invited (non-active) upgradedOnly user is reported, not processed
      expect(result.upgradedOnlyNonActive).toBe(1);
      expect(result.sent).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.unset).toBe(0);

      // No email attempted and no DB change.
      expect(sendResetEmailForUser).not.toHaveBeenCalled();
      const after = await collection
        .find(markerFilter)
        .sort({ _id: 1 })
        .toArray();
      expect(after).toEqual(before);
    });
  });

  describe('send mode: SEND_RESET_EMAILS=true (Req 4.2, 4.3)', () => {
    it('emails every ACTIVE upgradedOnly user and unsets passwordHash only on send success', async () => {
      const upgradedOnlyCount = 4;
      const failUsername = `${MARKER}-upgraded-2`;
      const docs: Record<string, unknown>[] = [];
      for (let i = 0; i < upgradedOnlyCount; i++) {
        docs.push({
          _id: new ObjectId(),
          username: `${MARKER}-upgraded-${i}`,
          email: `${MARKER}-upgraded-${i}@example.com`,
          status: UserStatus.STATUS_ACTIVE,
          passwordHash: `scrypt$hash-${i}`,
        });
      }
      // a non-upgradedOnly user that must never be contacted
      docs.push({
        _id: new ObjectId(),
        username: `${MARKER}-both-0`,
        status: UserStatus.STATUS_ACTIVE,
        passwordHash: 'scrypt$hash',
        password: 'legacy-sha256',
      });
      await collection.insertMany(docs);

      // Reject the send for exactly one user; resolve for the rest.
      const sendResetEmailForUser = vi.fn(
        (user: WithId<Document>): Promise<void> => {
          if (user.username === failUsername) {
            return Promise.reject(new Error('SMTP failure'));
          }
          return Promise.resolve();
        },
      );

      const result = await runDowngradePrep({
        usersCollection: collection,
        sendResetEmailForUser,
        sendResetEmails: true,
        isPasswordResetAvailable: true,
        baseFilter: markerFilter,
      });

      expect(result.upgradedOnly).toBe(upgradedOnlyCount);
      expect(result.upgradedOnlyNonActive).toBe(0);
      expect(result.sent).toBe(upgradedOnlyCount - 1);
      expect(result.failed).toBe(1);
      expect(result.unset).toBe(upgradedOnlyCount - 1);

      // Called exactly once per upgradedOnly user (never the `both` user).
      expect(sendResetEmailForUser).toHaveBeenCalledTimes(upgradedOnlyCount);

      // Success users: passwordHash FIELD is absent (removed, not null).
      const successUsers = await collection
        .find({
          username: { $regex: `^${MARKER}-upgraded` },
          _id: { $ne: undefined },
        })
        .toArray();
      for (const doc of successUsers) {
        if (doc.username === failUsername) {
          // Failure user: passwordHash untouched so a re-run retries it.
          expect(typeof doc.passwordHash).toBe('string');
        } else {
          expect('passwordHash' in doc).toBe(false);
        }
      }

      // The `both` user is completely untouched.
      const both = await collection.findOne({ username: `${MARKER}-both-0` });
      expect(both?.passwordHash).toBe('scrypt$hash');
      expect(both?.password).toBe('legacy-sha256');
    });

    it('never emails or unsets a NON-ACTIVE upgradedOnly user (no recovery path → permanent lockout)', async () => {
      const nonActiveStatuses = [
        UserStatus.STATUS_INVITED,
        UserStatus.STATUS_REGISTERED,
        UserStatus.STATUS_SUSPENDED,
      ];
      const docs: Record<string, unknown>[] = [
        {
          _id: new ObjectId(),
          username: `${MARKER}-upgraded-active`,
          email: `${MARKER}-upgraded-active@example.com`,
          status: UserStatus.STATUS_ACTIVE,
          passwordHash: 'scrypt$hash-active',
        },
        ...nonActiveStatuses.map((status) => ({
          _id: new ObjectId(),
          username: `${MARKER}-upgraded-nonactive-${status}`,
          email: `${MARKER}-upgraded-nonactive-${status}@example.com`,
          status,
          passwordHash: `scrypt$hash-nonactive-${status}`,
        })),
      ];
      await collection.insertMany(docs);

      const sendResetEmailForUser = vi.fn(
        (_user: WithId<Document>): Promise<void> => Promise.resolve(),
      );

      const result = await runDowngradePrep({
        usersCollection: collection,
        sendResetEmailForUser,
        sendResetEmails: true,
        isPasswordResetAvailable: true,
        baseFilter: markerFilter,
      });

      expect(result.upgradedOnly).toBe(1);
      expect(result.upgradedOnlyNonActive).toBe(nonActiveStatuses.length);
      expect(result.sent).toBe(1);
      expect(result.unset).toBe(1);

      // Only the ACTIVE user was contacted.
      expect(sendResetEmailForUser).toHaveBeenCalledTimes(1);
      expect(sendResetEmailForUser).toHaveBeenCalledWith(
        expect.objectContaining({ username: `${MARKER}-upgraded-active` }),
      );

      const active = await collection.findOne({
        username: `${MARKER}-upgraded-active`,
      });
      expect(active != null && 'passwordHash' in active).toBe(false);

      // Non-active users keep their credential — unsetting it would lock them
      // out permanently (forgot-password rejects non-active users).
      const nonActive = await collection
        .find({ username: { $regex: `^${MARKER}-upgraded-nonactive` } })
        .toArray();
      expect(nonActive).toHaveLength(nonActiveStatuses.length);
      for (const doc of nonActive) {
        expect(typeof doc.passwordHash).toBe('string');
      }
    });

    it('re-classifies unset users as noPassword so a re-run does not re-email them (Req 4.3)', async () => {
      const upgradedOnlyCount = 3;
      const docs: Record<string, unknown>[] = [];
      for (let i = 0; i < upgradedOnlyCount; i++) {
        docs.push({
          _id: new ObjectId(),
          username: `${MARKER}-upgraded-${i}`,
          email: `${MARKER}-upgraded-${i}@example.com`,
          status: UserStatus.STATUS_ACTIVE,
          passwordHash: `scrypt$hash-${i}`,
        });
      }
      await collection.insertMany(docs);

      const sendResetEmailForUser = vi.fn(
        (_user: WithId<Document>): Promise<void> => Promise.resolve(),
      );

      const first = await runDowngradePrep({
        usersCollection: collection,
        sendResetEmailForUser,
        sendResetEmails: true,
        isPasswordResetAvailable: true,
        baseFilter: markerFilter,
      });
      expect(first.sent).toBe(upgradedOnlyCount);
      expect(first.unset).toBe(upgradedOnlyCount);

      // After $unset, the status-migration classification query must no longer
      // count these users as upgradedOnly (proves $unset, not null → noPassword).
      const stillUpgradedOnly = await collection.countDocuments({
        username: { $regex: `^${MARKER}` },
        ...isUpgradedOnly,
      });
      expect(stillUpgradedOnly).toBe(0);

      // A re-run finds nothing to do — no double email.
      sendResetEmailForUser.mockClear();
      const second = await runDowngradePrep({
        usersCollection: collection,
        sendResetEmailForUser,
        sendResetEmails: true,
        isPasswordResetAvailable: true,
        baseFilter: markerFilter,
      });
      expect(second.upgradedOnly).toBe(0);
      expect(second.sent).toBe(0);
      expect(sendResetEmailForUser).not.toHaveBeenCalled();
    });
  });

  describe('password-reset path unavailable', () => {
    const seedActiveUpgradedOnly = async (count: number) => {
      const docs = Array.from({ length: count }, (_, i) => ({
        _id: new ObjectId(),
        username: `${MARKER}-upgraded-${i}`,
        email: `${MARKER}-upgraded-${i}@example.com`,
        status: UserStatus.STATUS_ACTIVE,
        passwordHash: `scrypt$hash-${i}`,
      }));
      await collection.insertMany(docs);
      return docs.length;
    };

    it('refuses send mode: no email is sent and no passwordHash is unset', async () => {
      // Unsetting passwordHash while /forgot-password is gated off would leave
      // these users with no credential AND no recovery path (DB surgery only).
      const seeded = await seedActiveUpgradedOnly(3);
      const before = await collection
        .find(markerFilter)
        .sort({ _id: 1 })
        .toArray();

      const sendResetEmailForUser = vi.fn(
        (_user: WithId<Document>): Promise<void> => Promise.resolve(),
      );

      const result = await runDowngradePrep({
        usersCollection: collection,
        sendResetEmailForUser,
        sendResetEmails: true,
        isPasswordResetAvailable: false,
        baseFilter: markerFilter,
      });

      // Assert the harm first: nothing mailed, nothing written.
      expect(sendResetEmailForUser).not.toHaveBeenCalled();
      const after = await collection
        .find(markerFilter)
        .sort({ _id: 1 })
        .toArray();
      expect(after).toEqual(before);
      for (const doc of after) {
        expect(typeof doc.passwordHash).toBe('string');
      }

      expect(result.aborted).toBe(true);
      expect(result.sent).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.unset).toBe(0);
      // The scale of the problem is still reported so the admin can act on it.
      expect(result.upgradedOnly).toBe(seeded);
    });

    it('still reports counts in report-only mode (it makes no writes, so the reset path is irrelevant)', async () => {
      const seeded = await seedActiveUpgradedOnly(2);

      const sendResetEmailForUser = vi.fn(
        (_user: WithId<Document>): Promise<void> => Promise.resolve(),
      );

      const result = await runDowngradePrep({
        usersCollection: collection,
        sendResetEmailForUser,
        sendResetEmails: false,
        isPasswordResetAvailable: false,
        baseFilter: markerFilter,
      });

      expect(result.aborted).toBe(false);
      expect(result.upgradedOnly).toBe(seeded);
      expect(sendResetEmailForUser).not.toHaveBeenCalled();
    });
  });
});
