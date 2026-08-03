import type { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IUser, IUserGroup } from '@growi/core';
import type { Model } from 'mongoose';
import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import {
  setupIndependentModels,
  setupModelsDependentOnCrowi,
} from '~/server/crowi/setup-models';
import type UserEvent from '~/server/events/user';

import { detectUniqueConflicts } from './detect-unique-conflicts';

// Fixture values carry a distinctive prefix so they cannot collide with documents that
// other integration test files may have left behind in the per-worker database.
const EXISTING_USER = {
  name: 'g2g-detect existing admin',
  username: 'g2g-detect-existing-admin',
  email: 'g2g-detect-existing-admin@example.com',
  slackMemberId: 'UG2GDETECTEXISTING',
  // A non-unique field that both sides share: detection must never compare it.
  password: 'g2g-detect-shared-password-hash',
} as const;

const ARCHIVE_USER = {
  username: 'g2g-detect-archive-user',
  email: 'g2g-detect-archive-user@example.com',
  slackMemberId: 'UG2GDETECTARCHIVE',
} as const;

const EXISTING_GROUP_NAME = 'g2g-detect-existing-group';
const ARCHIVE_GROUP_NAME = 'g2g-detect-archive-group';

// The archive stores `_id` as a hex string (the export service JSON-stringifies the raw
// driver documents), while the destination returns ObjectId. These ids are deliberately
// different from anything Mongo would generate for the seeded documents.
const ARCHIVE_USER_ID = '0123456789abcdef01230001';
const ARCHIVE_GROUP_ID = '0123456789abcdef01230002';
const ARCHIVE_OTHER_USER_ID = '0123456789abcdef01230003';

describe('detectUniqueConflicts', () => {
  let User: Model<IUser>;
  let UserGroup: Model<IUserGroup>;
  let tmpDir: string;

  const writeArchiveJson = async (
    fileName: string,
    docs: readonly Record<string, unknown>[],
  ): Promise<string> => {
    const filePath = path.join(tmpDir, fileName);
    // Same shape the export service produces: one top-level JSON array of documents.
    await fs.writeFile(filePath, JSON.stringify(docs), 'utf-8');
    return filePath;
  };

  // Writes the file contents verbatim, so a test can hand over an archive that is
  // truncated, empty or not an array at all.
  const writeRawArchive = async (
    fileName: string,
    contents: string,
  ): Promise<string> => {
    const filePath = path.join(tmpDir, fileName);
    await fs.writeFile(filePath, contents, 'utf-8');
    return filePath;
  };

  const seedExistingUser = async (): Promise<string> => {
    const created = await User.create({ ...EXISTING_USER });
    return String(created._id);
  };

  const seedExistingGroup = async (): Promise<string> => {
    const created = await UserGroup.create({ name: EXISTING_GROUP_NAME });
    return String(created._id);
  };

  const removeFixtures = async (): Promise<void> => {
    await User.deleteMany({
      username: { $in: [EXISTING_USER.username, ARCHIVE_USER.username] },
    });
    await UserGroup.deleteMany({
      name: { $in: [EXISTING_GROUP_NAME, ARCHIVE_GROUP_NAME] },
    });
  };

  // Whole-collection snapshots (raw driver reads, so timestamps and __v are included)
  // are the evidence that detection does not touch the destination data.
  const snapshotDestination = async (): Promise<unknown> => {
    const users = await mongoose.connection
      .collection('users')
      .find({})
      .sort({ _id: 1 })
      .toArray();
    const usergroups = await mongoose.connection
      .collection('usergroups')
      .find({})
      .sort({ _id: 1 })
      .toArray();
    return { users, usergroups };
  };

  beforeAll(async () => {
    // PageEvent is a JS file with type 'any' in the Crowi interface
    const crowiMock = mock<Crowi>({
      events: {
        page: mock<EventEmitter>(),
        user: mock<UserEvent>(),
      },
    });
    await setupModelsDependentOnCrowi(crowiMock);
    await setupIndependentModels();

    User = mongoose.model<IUser>('User');
    UserGroup = mongoose.model<IUserGroup>('UserGroup');

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'g2g-detect-conflicts-'));

    await removeFixtures();
  });

  afterEach(async () => {
    await removeFixtures();
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('users collection', () => {
    test('detects a username conflict when the archive user shares the username under a different _id', async () => {
      // Requirement 1.1, 5.1
      const existingId = await seedExistingUser();
      const usersJsonPath = await writeArchiveJson('users-username.json', [
        {
          _id: ARCHIVE_USER_ID,
          username: EXISTING_USER.username,
          email: ARCHIVE_USER.email,
          slackMemberId: ARCHIVE_USER.slackMemberId,
          password: 'g2g-detect-archive-password-hash',
        },
      ]);

      const report = await detectUniqueConflicts({
        usersJsonPath,
        groupsJsonPath: null,
        userModel: User,
        userGroupModel: UserGroup,
      });

      expect(report.userConflicts).toEqual([
        {
          collection: 'users',
          field: 'username',
          value: EXISTING_USER.username,
          archiveId: ARCHIVE_USER_ID,
          existingId,
        },
      ]);
      expect(report.groupConflicts).toEqual([]);
    });

    test('detects an email conflict when the archive user shares the email under a different _id', async () => {
      // Requirement 1.2, 5.1 — the issue #10151 scenario: destination is already set up
      // with an admin account that shares the e-mail address of an archived user.
      const existingId = await seedExistingUser();
      const usersJsonPath = await writeArchiveJson('users-email.json', [
        {
          _id: ARCHIVE_USER_ID,
          username: ARCHIVE_USER.username,
          email: EXISTING_USER.email,
          slackMemberId: ARCHIVE_USER.slackMemberId,
        },
      ]);

      const report = await detectUniqueConflicts({
        usersJsonPath,
        groupsJsonPath: null,
        userModel: User,
        userGroupModel: UserGroup,
      });

      expect(report.userConflicts).toEqual([
        {
          collection: 'users',
          field: 'email',
          value: EXISTING_USER.email,
          archiveId: ARCHIVE_USER_ID,
          existingId,
        },
      ]);
    });

    test('detects a slackMemberId conflict when the archive user shares the slackMemberId under a different _id', async () => {
      // Requirement 1.3
      const existingId = await seedExistingUser();
      const usersJsonPath = await writeArchiveJson('users-slack.json', [
        {
          _id: ARCHIVE_USER_ID,
          username: ARCHIVE_USER.username,
          email: ARCHIVE_USER.email,
          slackMemberId: EXISTING_USER.slackMemberId,
        },
      ]);

      const report = await detectUniqueConflicts({
        usersJsonPath,
        groupsJsonPath: null,
        userModel: User,
        userGroupModel: UserGroup,
      });

      expect(report.userConflicts).toEqual([
        {
          collection: 'users',
          field: 'slackMemberId',
          value: EXISTING_USER.slackMemberId,
          archiveId: ARCHIVE_USER_ID,
          existingId,
        },
      ]);
    });

    test('reports no conflict when the archive user is the same document (same _id) as the existing user', async () => {
      // Requirement 1.5 — re-importing the same document. The destination returns `_id`
      // as an ObjectId while the archive holds a hex string, so this also pins that both
      // sides are compared as strings.
      const existingId = await seedExistingUser();
      const usersJsonPath = await writeArchiveJson('users-same-id.json', [
        {
          _id: existingId,
          username: EXISTING_USER.username,
          email: EXISTING_USER.email,
          slackMemberId: EXISTING_USER.slackMemberId,
        },
      ]);

      const report = await detectUniqueConflicts({
        usersJsonPath,
        groupsJsonPath: null,
        userModel: User,
        userGroupModel: UserGroup,
      });

      expect(report.userConflicts).toEqual([]);
      expect(report.groupConflicts).toEqual([]);
    });

    test('reports no conflict when no unique field value overlaps with the destination', async () => {
      await seedExistingUser();
      const usersJsonPath = await writeArchiveJson('users-no-overlap.json', [
        {
          _id: ARCHIVE_USER_ID,
          username: ARCHIVE_USER.username,
          email: ARCHIVE_USER.email,
          slackMemberId: ARCHIVE_USER.slackMemberId,
        },
      ]);

      const report = await detectUniqueConflicts({
        usersJsonPath,
        groupsJsonPath: null,
        userModel: User,
        userGroupModel: UserGroup,
      });

      expect(report).toEqual({ userConflicts: [], groupConflicts: [] });
    });

    test('does not compare fields outside the declared unique fields', async () => {
      // Security Considerations: only username / email / slackMemberId are read and
      // compared. Here both sides share a password hash and nothing else, which is not a
      // unique-index violation and must not be reported.
      await seedExistingUser();
      const usersJsonPath = await writeArchiveJson(
        'users-shared-password.json',
        [
          {
            _id: ARCHIVE_USER_ID,
            username: ARCHIVE_USER.username,
            email: ARCHIVE_USER.email,
            slackMemberId: ARCHIVE_USER.slackMemberId,
            password: EXISTING_USER.password,
            name: EXISTING_USER.name,
          },
        ],
      );

      const report = await detectUniqueConflicts({
        usersJsonPath,
        groupsJsonPath: null,
        userModel: User,
        userGroupModel: UserGroup,
      });

      expect(report).toEqual({ userConflicts: [], groupConflicts: [] });
    });

    test('reports no conflict for an archive that contains no documents', async () => {
      await seedExistingUser();
      const usersJsonPath = await writeArchiveJson('users-empty.json', []);

      const report = await detectUniqueConflicts({
        usersJsonPath,
        groupsJsonPath: null,
        userModel: User,
        userGroupModel: UserGroup,
      });

      expect(report).toEqual({ userConflicts: [], groupConflicts: [] });
    });
  });

  describe('usergroups collection', () => {
    test('detects a name conflict when the archive group shares the name under a different _id', async () => {
      // Requirement 1.4
      const existingId = await seedExistingGroup();
      const groupsJsonPath = await writeArchiveJson('usergroups-name.json', [
        {
          _id: ARCHIVE_GROUP_ID,
          name: EXISTING_GROUP_NAME,
          description: 'archived group',
        },
      ]);

      const report = await detectUniqueConflicts({
        usersJsonPath: null,
        groupsJsonPath,
        userModel: User,
        userGroupModel: UserGroup,
      });

      expect(report.groupConflicts).toEqual([
        {
          collection: 'usergroups',
          field: 'name',
          value: EXISTING_GROUP_NAME,
          archiveId: ARCHIVE_GROUP_ID,
          existingId,
        },
      ]);
      expect(report.userConflicts).toEqual([]);
    });

    test('reports no conflict when the archive group is the same document (same _id) as the existing group', async () => {
      // Requirement 1.5
      const existingId = await seedExistingGroup();
      const groupsJsonPath = await writeArchiveJson('usergroups-same-id.json', [
        { _id: existingId, name: EXISTING_GROUP_NAME },
      ]);

      const report = await detectUniqueConflicts({
        usersJsonPath: null,
        groupsJsonPath,
        userModel: User,
        userGroupModel: UserGroup,
      });

      expect(report.groupConflicts).toEqual([]);
    });
  });

  describe('collections missing from the transfer target', () => {
    test('skips user detection without throwing when usersJsonPath is null, and still detects group conflicts', async () => {
      // Requirement 1.6 — a missing users JSON must not block the other collections.
      await seedExistingUser();
      const existingGroupId = await seedExistingGroup();
      const groupsJsonPath = await writeArchiveJson('usergroups-only.json', [
        { _id: ARCHIVE_GROUP_ID, name: EXISTING_GROUP_NAME },
      ]);

      const report = await detectUniqueConflicts({
        usersJsonPath: null,
        groupsJsonPath,
        userModel: User,
        userGroupModel: UserGroup,
      });

      expect(report.userConflicts).toEqual([]);
      expect(report.groupConflicts).toEqual([
        {
          collection: 'usergroups',
          field: 'name',
          value: EXISTING_GROUP_NAME,
          archiveId: ARCHIVE_GROUP_ID,
          existingId: existingGroupId,
        },
      ]);
    });

    test('skips group detection without throwing when groupsJsonPath is null, and still detects user conflicts', async () => {
      // Requirement 1.6
      const existingUserId = await seedExistingUser();
      await seedExistingGroup();
      const usersJsonPath = await writeArchiveJson('users-only.json', [
        {
          _id: ARCHIVE_USER_ID,
          username: ARCHIVE_USER.username,
          email: EXISTING_USER.email,
        },
      ]);

      const report = await detectUniqueConflicts({
        usersJsonPath,
        groupsJsonPath: null,
        userModel: User,
        userGroupModel: UserGroup,
      });

      expect(report.groupConflicts).toEqual([]);
      expect(report.userConflicts).toEqual([
        {
          collection: 'users',
          field: 'email',
          value: EXISTING_USER.email,
          archiveId: ARCHIVE_USER_ID,
          existingId: existingUserId,
        },
      ]);
    });

    test('returns an empty report without throwing when neither collection is part of the transfer', async () => {
      // Requirement 1.6
      await seedExistingUser();
      await seedExistingGroup();

      const report = await detectUniqueConflicts({
        usersJsonPath: null,
        groupsJsonPath: null,
        userModel: User,
        userGroupModel: UserGroup,
      });

      expect(report).toEqual({ userConflicts: [], groupConflicts: [] });
    });
  });

  describe('read-only guarantee', () => {
    test('leaves the destination users and usergroups untouched while detecting conflicts', async () => {
      // Requirement 2.4 — the whole point of gating before the import is that nothing is
      // written. Compare full documents (timestamps and __v included), not just counts.
      await seedExistingUser();
      await seedExistingGroup();

      const usersJsonPath = await writeArchiveJson('users-readonly.json', [
        {
          _id: ARCHIVE_USER_ID,
          username: EXISTING_USER.username,
          email: EXISTING_USER.email,
          slackMemberId: EXISTING_USER.slackMemberId,
        },
      ]);
      const groupsJsonPath = await writeArchiveJson(
        'usergroups-readonly.json',
        [{ _id: ARCHIVE_GROUP_ID, name: EXISTING_GROUP_NAME }],
      );

      const before = await snapshotDestination();

      const report = await detectUniqueConflicts({
        usersJsonPath,
        groupsJsonPath,
        userModel: User,
        userGroupModel: UserGroup,
      });

      const after = await snapshotDestination();

      // Guard against a vacuous read-only check: this run must really have found something.
      expect(report.userConflicts).toHaveLength(3);
      expect(report.groupConflicts).toHaveLength(1);
      expect(after).toEqual(before);
    });
  });

  describe('unreadable or incomplete archive JSON', () => {
    // A partially readable archive must fail loudly, never resolve. The caller (the
    // receive route) reads the returned report to decide whether importing is safe, so
    // "no conflicts" and "could not finish reading" must never look the same.
    const truncateJson = (docs: readonly Record<string, unknown>[]): string => {
      const complete = JSON.stringify(docs);
      // Cut into the last document so its object never closes and neither does the array.
      return complete.slice(0, complete.length - 20);
    };

    test('rejects when the archive JSON is truncated before a conflicting document', async () => {
      // WHY this is the worst case: JSONStream emits neither an error nor a completion
      // event when the root array never closes, so a document cut off mid-way is simply
      // never emitted. If that document was the conflicting one, resolving with an empty
      // report would tell the caller "safe to import", the import would run, and
      // bulk.insert() would silently drop the conflicting user — reproducing issue #10151,
      // the exact breakage this detection exists to prevent.
      await seedExistingUser();
      const usersJsonPath = await writeRawArchive(
        'users-truncated-before-conflict.json',
        truncateJson([
          {
            _id: ARCHIVE_OTHER_USER_ID,
            username: ARCHIVE_USER.username,
            email: ARCHIVE_USER.email,
          },
          {
            // The conflicting document: same email as the seeded user, different _id.
            _id: ARCHIVE_USER_ID,
            username: 'g2g-detect-truncated-user',
            email: EXISTING_USER.email,
          },
        ]),
      );

      await expect(
        detectUniqueConflicts({
          usersJsonPath,
          groupsJsonPath: null,
          userModel: User,
          userGroupModel: UserGroup,
        }),
      ).rejects.toThrow();
    });

    test('rejects when the archive JSON is truncated after a conflicting document', async () => {
      // Reporting the conflicts found so far as if the archive had been read in full is
      // just as wrong: the unread remainder may hold further conflicts.
      await seedExistingUser();
      const usersJsonPath = await writeRawArchive(
        'users-truncated-after-conflict.json',
        truncateJson([
          {
            _id: ARCHIVE_USER_ID,
            username: 'g2g-detect-truncated-user',
            email: EXISTING_USER.email,
          },
          {
            _id: ARCHIVE_OTHER_USER_ID,
            username: ARCHIVE_USER.username,
            email: ARCHIVE_USER.email,
          },
        ]),
      );

      await expect(
        detectUniqueConflicts({
          usersJsonPath,
          groupsJsonPath: null,
          userModel: User,
          userGroupModel: UserGroup,
        }),
      ).rejects.toThrow();
    });

    test('rejects when the archive JSON is a zero-byte file', async () => {
      // A zero-byte file is a failed export/unzip, not an empty collection. The companion
      // test "reports no conflict for an archive that contains no documents" covers the
      // legitimately empty archive `[]`; both must stay to prove the two are told apart.
      await seedExistingUser();
      const usersJsonPath = await writeRawArchive('users-zero-byte.json', '');

      await expect(
        detectUniqueConflicts({
          usersJsonPath,
          groupsJsonPath: null,
          userModel: User,
          userGroupModel: UserGroup,
        }),
      ).rejects.toThrow();
    });

    test('rejects when the archive JSON is an object instead of an array of documents', async () => {
      await seedExistingUser();
      const usersJsonPath = await writeRawArchive(
        'users-object.json',
        JSON.stringify({
          someKey: {
            _id: ARCHIVE_USER_ID,
            username: ARCHIVE_USER.username,
            email: EXISTING_USER.email,
          },
        }),
      );

      await expect(
        detectUniqueConflicts({
          usersJsonPath,
          groupsJsonPath: null,
          userModel: User,
          userGroupModel: UserGroup,
        }),
      ).rejects.toThrow();
    });

    test('rejects when the archive JSON file does not exist', async () => {
      await expect(
        detectUniqueConflicts({
          usersJsonPath: path.join(tmpDir, 'users-does-not-exist.json'),
          groupsJsonPath: null,
          userModel: User,
          userGroupModel: UserGroup,
        }),
      ).rejects.toThrow();
    });

    test('rejects when the destination lookup fails', async () => {
      // Failing to read the destination must not be reported as "no conflicts" either.
      const usersJsonPath = await writeArchiveJson(
        'users-lookup-failure.json',
        [
          {
            _id: ARCHIVE_USER_ID,
            username: ARCHIVE_USER.username,
            email: EXISTING_USER.email,
          },
        ],
      );
      // `find` is overloaded, so DeepPartial<Model<IUser>> cannot express it as an
      // override object; set the behaviour on the auto-stubbed proxy instead.
      const failingUserModel = mock<Model<IUser>>();
      failingUserModel.find.mockImplementation(() => {
        throw new Error('lookup exploded');
      });

      await expect(
        detectUniqueConflicts({
          usersJsonPath,
          groupsJsonPath: null,
          userModel: failingUserModel,
          userGroupModel: UserGroup,
        }),
      ).rejects.toThrow('lookup exploded');
    });
  });
});
