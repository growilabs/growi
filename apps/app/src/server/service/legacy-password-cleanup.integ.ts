// Contract: design.md "Testing Strategy → Integration（service）". Fixtures are
// marker-scoped so the shared `users` collection is never touched beyond them.
import type { Collection } from 'mongodb';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';

import { UserStatus } from '../models/user/conts';
import {
  countPasswordHashFormats,
  unsetLegacyPasswordOfMigratedUsers,
} from './legacy-password-cleanup';
import { passwordHashService } from './password-hash';

const MARKER = 'legacy-pw-cleanup-svc-test';
const markerFilter = { username: { $regex: `^${MARKER}` } };

describe('legacy-password-cleanup service', () => {
  let collection: Collection;

  const seed = async (
    docs: { name: string; fields: Record<string, unknown> }[],
  ) => {
    await collection.insertMany(
      docs.map(({ name, fields }) => ({
        _id: new ObjectId(),
        username: `${MARKER}-${name}`,
        ...fields,
      })),
    );
  };

  beforeAll(() => {
    collection = mongoose.connection.collection('users');
  });

  beforeEach(async () => {
    await collection.deleteMany(markerFilter);
  });

  afterEach(async () => {
    await collection.deleteMany(markerFilter);
  });

  describe('countPasswordHashFormats (Req 1.1, 1.2, 1.3)', () => {
    it('counts each category and splits legacyOnly into ACTIVE / non-active', async () => {
      await seed([
        {
          name: 'up-0',
          fields: { status: UserStatus.STATUS_ACTIVE, passwordHash: 'h' },
        },
        {
          name: 'up-1',
          fields: { status: UserStatus.STATUS_SUSPENDED, passwordHash: 'h' },
        },
        {
          name: 'both-0',
          fields: {
            status: UserStatus.STATUS_ACTIVE,
            passwordHash: 'h',
            password: 'p',
          },
        },
        {
          name: 'both-1',
          fields: {
            status: UserStatus.STATUS_SUSPENDED,
            passwordHash: 'h',
            password: 'p',
          },
        },
        {
          name: 'both-2',
          fields: {
            status: UserStatus.STATUS_INVITED,
            passwordHash: 'h',
            password: 'p',
          },
        },
        {
          name: 'legacy-a0',
          fields: { status: UserStatus.STATUS_ACTIVE, password: 'p' },
        },
        {
          name: 'legacy-a1',
          fields: { status: UserStatus.STATUS_ACTIVE, password: 'p' },
        },
        {
          name: 'legacy-n0',
          fields: { status: UserStatus.STATUS_SUSPENDED, password: 'p' },
        },
        { name: 'none-0', fields: { status: UserStatus.STATUS_ACTIVE } },
      ]);

      const counts = await countPasswordHashFormats(collection, markerFilter);

      expect(counts).toEqual({
        upgradedOnly: 2,
        both: 3,
        legacyOnly: { active: 2, nonActive: 1 },
        noPassword: 1,
      });
    });

    it('treats an empty-string or null password as absent (noPassword / upgradedOnly)', async () => {
      await seed([
        {
          name: 'deleted-empty',
          fields: { status: UserStatus.STATUS_DELETED, password: '' },
        },
        {
          name: 'deleted-null',
          fields: { status: UserStatus.STATUS_DELETED, password: null },
        },
        {
          name: 'up-empty-legacy',
          fields: {
            status: UserStatus.STATUS_ACTIVE,
            passwordHash: 'h',
            password: '',
          },
        },
      ]);

      const counts = await countPasswordHashFormats(collection, markerFilter);

      expect(counts).toEqual({
        upgradedOnly: 1,
        both: 0,
        legacyOnly: { active: 0, nonActive: 0 },
        noPassword: 2,
      });
    });

    it('returns all zeros when no user matches the base filter', async () => {
      const counts = await countPasswordHashFormats(collection, markerFilter);

      expect(counts).toEqual({
        upgradedOnly: 0,
        both: 0,
        legacyOnly: { active: 0, nonActive: 0 },
        noPassword: 0,
      });
    });
  });

  describe('unsetLegacyPasswordOfMigratedUsers (Req 2.1, 2.2, 2.3, 2.6, 2.8)', () => {
    it('unsets password from every both user regardless of status, keeps passwordHash, leaves other categories unchanged', async () => {
      await seed([
        {
          name: 'both-active',
          fields: {
            status: UserStatus.STATUS_ACTIVE,
            passwordHash: 'h-a',
            password: 'p',
          },
        },
        {
          name: 'both-suspended',
          fields: {
            status: UserStatus.STATUS_SUSPENDED,
            passwordHash: 'h-s',
            password: 'p',
          },
        },
        {
          name: 'both-invited',
          fields: {
            status: UserStatus.STATUS_INVITED,
            passwordHash: 'h-i',
            password: 'p',
          },
        },
        {
          name: 'up-0',
          fields: { status: UserStatus.STATUS_ACTIVE, passwordHash: 'h-u' },
        },
        {
          name: 'legacy-n0',
          fields: { status: UserStatus.STATUS_SUSPENDED, password: 'p' },
        },
        { name: 'none-0', fields: { status: UserStatus.STATUS_ACTIVE } },
      ]);
      const othersBefore = await collection
        .find({ username: { $regex: `^${MARKER}-(up|legacy|none)` } })
        .sort({ _id: 1 })
        .toArray();

      const result = await unsetLegacyPasswordOfMigratedUsers(
        collection,
        markerFilter,
      );

      expect(result).toEqual({ unset: 3 });
      const both = await collection
        .find({ username: { $regex: `^${MARKER}-both` } })
        .toArray();
      expect(both).toHaveLength(3);
      for (const doc of both) {
        expect(doc).not.toHaveProperty('password');
        expect(doc.passwordHash).toMatch(/^h-/);
      }
      const othersAfter = await collection
        .find({ username: { $regex: `^${MARKER}-(up|legacy|none)` } })
        .sort({ _id: 1 })
        .toArray();
      expect(othersAfter).toEqual(othersBefore);
    });

    it('still unsets when ACTIVE legacyOnly users exist (no abort), leaving them untouched', async () => {
      await seed([
        {
          name: 'legacy-a0',
          fields: { status: UserStatus.STATUS_ACTIVE, password: 'p' },
        },
        {
          name: 'both-0',
          fields: {
            status: UserStatus.STATUS_ACTIVE,
            passwordHash: 'h',
            password: 'p',
          },
        },
      ]);

      const result = await unsetLegacyPasswordOfMigratedUsers(
        collection,
        markerFilter,
      );

      expect(result).toEqual({ unset: 1 });
      const legacy = await collection.findOne({
        username: `${MARKER}-legacy-a0`,
      });
      expect(legacy?.password).toBe('p');
    });

    it('returns unset 0 on a second call', async () => {
      await seed([
        {
          name: 'both-0',
          fields: {
            status: UserStatus.STATUS_ACTIVE,
            passwordHash: 'h',
            password: 'p',
          },
        },
      ]);

      const first = await unsetLegacyPasswordOfMigratedUsers(
        collection,
        markerFilter,
      );
      const second = await unsetLegacyPasswordOfMigratedUsers(
        collection,
        markerFilter,
      );

      expect(first).toEqual({ unset: 1 });
      expect(second).toEqual({ unset: 0 });
    });

    it('keeps the original plaintext verifiable via the scrypt hash after the unset', async () => {
      const plaintext = 'correct horse battery staple';
      const scryptHash = await passwordHashService.hash(plaintext);
      await seed([
        {
          name: 'both-verify',
          fields: {
            status: UserStatus.STATUS_ACTIVE,
            passwordHash: scryptHash,
            password: 'legacy-sha256-placeholder',
          },
        },
      ]);

      await unsetLegacyPasswordOfMigratedUsers(collection, markerFilter);

      const doc = await collection.findOne({
        username: `${MARKER}-both-verify`,
      });
      const verified = await passwordHashService.verify(
        plaintext,
        doc?.passwordHash,
        doc?.password,
        'seed',
      );
      expect(verified.isValid).toBe(true);
      const wrong = await passwordHashService.verify(
        'wrong',
        doc?.passwordHash,
        doc?.password,
        'seed',
      );
      expect(wrong.isValid).toBe(false);
    });
  });
});
