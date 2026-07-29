/**
 * Integration test for the password-hash downgrade-prep standalone script.
 *
 * Contract under test (implementation-agnostic — asserts observable behavior):
 *  - report-only default (SEND_RESET_EMAILS unset, Req 4.1): runDowngradePrep()
 *    counts `upgradedOnly` users (passwordHash only, no password — the users who
 *    would be LOCKED OUT after a downgrade) and makes NO DB change and sends
 *    nothing;
 *  - send mode (Req 4.2, 4.3): for each upgradedOnly user it invokes the injected
 *    sender (which creates the PasswordResetOrder + sends the reset email) and,
 *    ONLY after the send SUCCEEDS, `$unset`s that user's `passwordHash` field
 *    (field removal — NOT null); a user whose send FAILS keeps its passwordHash
 *    so a re-run retries it;
 *  - `$unset` (not null) regression (Req 4.3): an unset user is re-classified as
 *    `noPassword` and no longer counts as `upgradedOnly`, so a re-run neither
 *    double-counts nor double-emails them.
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

const MARKER = 'pwhash-downgrade-test';

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
  });

  afterEach(async () => {
    await collection.deleteMany({ username: { $regex: `^${MARKER}` } });
  });

  afterAll(async () => {
    await collection.deleteMany({ username: { $regex: `^${MARKER}` } });
  });

  describe('report-only default: SEND_RESET_EMAILS unset (Req 4.1)', () => {
    it('counts upgradedOnly users, sends nothing, and modifies no document', async () => {
      // Own the whole collection so the snapshot comparison is exact.
      await collection.deleteMany({});

      const upgradedOnlyCount = 3;
      const docs: Record<string, unknown>[] = [];
      // upgradedOnly: passwordHash only (would be locked out after downgrade)
      for (let i = 0; i < upgradedOnlyCount; i++) {
        docs.push({
          _id: new ObjectId(),
          username: `${MARKER}-upgraded-${i}`,
          email: `${MARKER}-upgraded-${i}@example.com`,
          passwordHash: `scrypt$hash-${i}`,
        });
      }
      // other categories that must NOT be counted or touched
      docs.push({
        _id: new ObjectId(),
        username: `${MARKER}-both-0`,
        passwordHash: 'scrypt$hash',
        password: 'legacy-sha256',
      });
      docs.push({
        _id: new ObjectId(),
        username: `${MARKER}-legacy-0`,
        password: 'legacy-sha256',
      });
      docs.push({ _id: new ObjectId(), username: `${MARKER}-nopass-0` });
      await collection.insertMany(docs);

      const before = await collection.find({}).sort({ _id: 1 }).toArray();

      const sendResetEmailForUser = vi.fn(
        (_user: WithId<Document>): Promise<void> => Promise.resolve(),
      );

      const result = await runDowngradePrep({
        usersCollection: collection,
        sendResetEmailForUser,
        sendResetEmails: false,
      });

      expect(result.upgradedOnly).toBe(upgradedOnlyCount);
      expect(result.sent).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.unset).toBe(0);

      // No email attempted and no DB change.
      expect(sendResetEmailForUser).not.toHaveBeenCalled();
      const after = await collection.find({}).sort({ _id: 1 }).toArray();
      expect(after).toEqual(before);
    });
  });

  describe('send mode: SEND_RESET_EMAILS=true (Req 4.2, 4.3)', () => {
    it('emails every upgradedOnly user and unsets passwordHash only on send success', async () => {
      await collection.deleteMany({});

      const upgradedOnlyCount = 4;
      const failUsername = `${MARKER}-upgraded-2`;
      const docs: Record<string, unknown>[] = [];
      for (let i = 0; i < upgradedOnlyCount; i++) {
        docs.push({
          _id: new ObjectId(),
          username: `${MARKER}-upgraded-${i}`,
          email: `${MARKER}-upgraded-${i}@example.com`,
          passwordHash: `scrypt$hash-${i}`,
        });
      }
      // a non-upgradedOnly user that must never be contacted
      docs.push({
        _id: new ObjectId(),
        username: `${MARKER}-both-0`,
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
      });

      expect(result.upgradedOnly).toBe(upgradedOnlyCount);
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

    it('re-classifies unset users as noPassword so a re-run does not re-email them (Req 4.3)', async () => {
      await collection.deleteMany({});

      const upgradedOnlyCount = 3;
      const docs: Record<string, unknown>[] = [];
      for (let i = 0; i < upgradedOnlyCount; i++) {
        docs.push({
          _id: new ObjectId(),
          username: `${MARKER}-upgraded-${i}`,
          email: `${MARKER}-upgraded-${i}@example.com`,
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
      });
      expect(second.upgradedOnly).toBe(0);
      expect(second.sent).toBe(0);
      expect(sendResetEmailForUser).not.toHaveBeenCalled();
    });
  });
});
