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

import { G2GTransferReceiverService } from './g2g-transfer';
import { GrowiBridgeService } from './growi-bridge';
import { initializeImportService } from './import';
import type { UniqueConflictReport } from './import/detect-unique-conflicts';

// The receive route hands over exactly this shape (fileName / collectionName / size);
// keeping `size` here pins that the method accepts what the route already has.
type InnerFileStat = {
  fileName: string;
  collectionName: string;
  size: number;
};

// Fixture values carry a distinctive prefix so they cannot collide with documents that
// other integration test files may have left behind in the per-worker database.
const EXISTING_USER = {
  name: 'g2g-recv existing admin',
  username: 'g2g-recv-existing-admin',
  email: 'g2g-recv-existing-admin@example.com',
  slackMemberId: 'UG2GRECVEXISTING',
} as const;

const ARCHIVE_USER = {
  username: 'g2g-recv-archive-user',
  email: 'g2g-recv-archive-user@example.com',
  slackMemberId: 'UG2GRECVARCHIVE',
} as const;

const DECOY_USER = {
  username: 'g2g-recv-decoy-user',
  email: 'g2g-recv-decoy-user@example.com',
} as const;

const EXISTING_GROUP_NAME = 'g2g-recv-existing-group';

// `providerType`+`accountId` is the composite unique key (models/external-account.ts);
// neither field alone identifies a conflict.
const EXISTING_EXTERNAL_ACCOUNT = {
  providerType: 'saml',
  accountId: 'g2g-recv-existing-account-id',
} as const;

// The archive stores `_id` as a hex string, and these ids are deliberately different from
// anything Mongo would generate for the seeded documents.
const ARCHIVE_USER_ID = '0123456789abcdef01240001';
const ARCHIVE_GROUP_ID = '0123456789abcdef01240002';
const DECOY_USER_ID = '0123456789abcdef01240003';
const ARCHIVE_EXTERNAL_ACCOUNT_ID = '0123456789abcdef01240004';

// A conflict report may carry no entry at all for a collection that was not part of the
// transfer (see detect-unique-conflicts.ts `isActive`), so every read goes through these
// helpers rather than indexing `conflictsByCollection` directly — the same convention
// `detect-unique-conflicts.integ.ts` established for its own assertions.
const getUserConflicts = (report: UniqueConflictReport): readonly unknown[] =>
  report.conflictsByCollection.get('users') ?? [];
const getGroupConflicts = (report: UniqueConflictReport): readonly unknown[] =>
  report.conflictsByCollection.get('usergroups') ?? [];
const getExternalAccountConflicts = (
  report: UniqueConflictReport,
): readonly unknown[] =>
  report.conflictsByCollection.get('externalaccounts') ?? [];

describe('G2GTransferReceiverService.detectImportConflicts', () => {
  let User: Model<IUser>;
  let UserGroup: Model<IUserGroup>;
  // `ExternalAccount` has no exported interface / default export (models/external-account.ts
  // keeps it Mongoose-registered only for index creation while its behavior lives in a
  // Prisma extension); fetched from the model registry untyped, exactly like the caller
  // (g2g-transfer.ts `detectImportConflicts`) already does.
  let ExternalAccount: Model<Record<string, unknown>>;
  let receiverService: G2GTransferReceiverService;
  let tmpDir: string;
  let importsDir: string;

  // ImportService.getFile resolves names against `<crowi.tmpDir>/imports`, which is the
  // directory the receive route unzips the archive into, so fixtures are written there.
  const writeArchiveJson = async (
    fileName: string,
    docs: readonly Record<string, unknown>[],
  ): Promise<void> => {
    // Same shape the export service produces: one top-level JSON array of documents.
    await fs.writeFile(
      path.join(importsDir, fileName),
      JSON.stringify(docs),
      'utf-8',
    );
  };

  const seedExistingUser = async (): Promise<string> => {
    const created = await User.create({ ...EXISTING_USER });
    return String(created._id);
  };

  const seedExistingGroup = async (): Promise<string> => {
    const created = await UserGroup.create({ name: EXISTING_GROUP_NAME });
    return String(created._id);
  };

  // `user` is a required ref on the ExternalAccount schema (models/external-account.ts);
  // its value is irrelevant to the providerType+accountId conflict under test, so it is
  // pointed at a real user to satisfy the schema without adding meaning to the fixture.
  const seedExistingExternalAccount = async (
    userId: string,
  ): Promise<string> => {
    const created = await ExternalAccount.create({
      ...EXISTING_EXTERNAL_ACCOUNT,
      user: userId,
    });
    return String(created._id);
  };

  const removeFixtures = async (): Promise<void> => {
    await User.deleteMany({
      $or: [
        {
          username: {
            $in: [
              EXISTING_USER.username,
              ARCHIVE_USER.username,
              DECOY_USER.username,
            ],
          },
        },
        // Belt and braces: if a regression ever imported the archive documents, they
        // must not leak into the following tests.
        { _id: { $in: [ARCHIVE_USER_ID, DECOY_USER_ID] } },
      ],
    });
    await UserGroup.deleteMany({
      $or: [
        { name: EXISTING_GROUP_NAME },
        { _id: { $in: [ARCHIVE_GROUP_ID] } },
      ],
    });
    await ExternalAccount.deleteMany({
      $or: [
        {
          providerType: EXISTING_EXTERNAL_ACCOUNT.providerType,
          accountId: EXISTING_EXTERNAL_ACCOUNT.accountId,
        },
        { _id: { $in: [ARCHIVE_EXTERNAL_ACCOUNT_ID] } },
      ],
    });
    // Each test declares the archive files it expects to be there, so the unzip directory
    // is emptied too — otherwise a file one test wrote could satisfy the next one.
    const leftovers = await fs.readdir(importsDir);
    await Promise.all(
      leftovers.map((fileName) => fs.rm(path.join(importsDir, fileName))),
    );
  };

  // Whole-collection snapshots (raw driver reads, so timestamps and __v are included) are
  // the evidence that this method detects without importing anything.
  const snapshotDestination = async (): Promise<unknown> => {
    const collectionNames = [
      'users',
      'usergroups',
      'usergrouprelations',
      'pages',
      'externalaccounts',
    ];
    const snapshots = await Promise.all(
      collectionNames.map((collectionName) =>
        mongoose.connection
          .collection(collectionName)
          .find({})
          .sort({ _id: 1 })
          .toArray(),
      ),
    );
    return Object.fromEntries(
      collectionNames.map((collectionName, i) => [
        collectionName,
        snapshots[i],
      ]),
    );
  };

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'g2g-recv-conflicts-'));
    importsDir = path.join(tmpDir, 'imports');
    await fs.mkdir(importsDir, { recursive: true });

    // PageEvent is a JS file with type 'any' in the Crowi interface
    const crowi = mock<Crowi>({
      tmpDir,
      events: {
        page: mock<EventEmitter>(),
        user: mock<UserEvent>(),
      },
    });
    // ImportService reads growiBridgeService in its constructor, so wire it up first.
    crowi.growiBridgeService = new GrowiBridgeService(crowi);
    initializeImportService(crowi);

    await setupModelsDependentOnCrowi(crowi);
    await setupIndependentModels();

    User = mongoose.model<IUser>('User');
    UserGroup = mongoose.model<IUserGroup>('UserGroup');
    ExternalAccount = mongoose.model('ExternalAccount');

    receiverService = new G2GTransferReceiverService(crowi);

    await removeFixtures();
  });

  afterEach(async () => {
    await removeFixtures();
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('detects conflicts for both collections when the archive carries users and usergroups', async () => {
    // Requirements 2.1, 2.4 — the report the route needs in order to stop the import.
    const existingUserId = await seedExistingUser();
    const existingGroupId = await seedExistingGroup();

    await writeArchiveJson('collection-0.json', [
      {
        _id: ARCHIVE_USER_ID,
        username: ARCHIVE_USER.username,
        email: EXISTING_USER.email,
      },
    ]);
    await writeArchiveJson('collection-1.json', [
      { _id: ARCHIVE_GROUP_ID, name: EXISTING_GROUP_NAME },
    ]);

    const innerFileStats: InnerFileStat[] = [
      { fileName: 'collection-0.json', collectionName: 'users', size: 1 },
      { fileName: 'collection-1.json', collectionName: 'usergroups', size: 1 },
    ];

    const report = await receiverService.detectImportConflicts(innerFileStats);

    expect(getUserConflicts(report)).toEqual([
      {
        collection: 'users',
        field: 'email',
        value: EXISTING_USER.email,
        archiveId: ARCHIVE_USER_ID,
        existingId: existingUserId,
      },
    ]);
    expect(getGroupConflicts(report)).toEqual([
      {
        collection: 'usergroups',
        field: 'name',
        value: EXISTING_GROUP_NAME,
        archiveId: ARCHIVE_GROUP_ID,
        existingId: existingGroupId,
      },
    ]);
  });

  test('resolves each archive file by its declared collectionName, not by a conventional file name', async () => {
    // The export service names inner files itself, so the collection a file holds is only
    // knowable from `collectionName`. The decoy below is literally named `users.json` and
    // holds no conflicting document: guessing the file name would report "no conflicts"
    // and let a breaking import through.
    const existingUserId = await seedExistingUser();

    await writeArchiveJson('users.json', [
      {
        _id: DECOY_USER_ID,
        username: DECOY_USER.username,
        email: DECOY_USER.email,
      },
    ]);
    await writeArchiveJson('9f8e7d6c.json', [
      {
        _id: ARCHIVE_USER_ID,
        username: EXISTING_USER.username,
        email: ARCHIVE_USER.email,
      },
    ]);

    const innerFileStats: InnerFileStat[] = [
      { fileName: '9f8e7d6c.json', collectionName: 'users', size: 1 },
    ];

    const report = await receiverService.detectImportConflicts(innerFileStats);

    expect(getUserConflicts(report)).toEqual([
      {
        collection: 'users',
        field: 'username',
        value: EXISTING_USER.username,
        archiveId: ARCHIVE_USER_ID,
        existingId: existingUserId,
      },
    ]);
  });

  describe('collections missing from the transfer target', () => {
    test('skips user detection without throwing when the archive has no users file, and still detects group conflicts', async () => {
      // Requirement 1.6 — a users file missing from the transfer must not block the rest.
      await seedExistingUser();
      const existingGroupId = await seedExistingGroup();

      await writeArchiveJson('groups-only.json', [
        { _id: ARCHIVE_GROUP_ID, name: EXISTING_GROUP_NAME },
      ]);

      const innerFileStats: InnerFileStat[] = [
        { fileName: 'groups-only.json', collectionName: 'usergroups', size: 1 },
      ];

      const report =
        await receiverService.detectImportConflicts(innerFileStats);

      expect(getUserConflicts(report)).toEqual([]);
      expect(getGroupConflicts(report)).toEqual([
        {
          collection: 'usergroups',
          field: 'name',
          value: EXISTING_GROUP_NAME,
          archiveId: ARCHIVE_GROUP_ID,
          existingId: existingGroupId,
        },
      ]);
    });

    test('skips group detection without throwing when the archive has no usergroups file, and still detects user conflicts', async () => {
      // Requirement 1.6
      const existingUserId = await seedExistingUser();
      await seedExistingGroup();

      await writeArchiveJson('users-only.json', [
        {
          _id: ARCHIVE_USER_ID,
          username: ARCHIVE_USER.username,
          email: EXISTING_USER.email,
        },
      ]);

      const innerFileStats: InnerFileStat[] = [
        { fileName: 'users-only.json', collectionName: 'users', size: 1 },
      ];

      const report =
        await receiverService.detectImportConflicts(innerFileStats);

      expect(getGroupConflicts(report)).toEqual([]);
      expect(getUserConflicts(report)).toEqual([
        {
          collection: 'users',
          field: 'email',
          value: EXISTING_USER.email,
          archiveId: ARCHIVE_USER_ID,
          existingId: existingUserId,
        },
      ]);
    });

    test('returns an empty report without throwing when the archive carries neither collection', async () => {
      // Requirement 1.6. The `pages` entry is a canary: its file deliberately does not
      // exist, so resolving any collection other than users / usergroups would throw.
      await seedExistingUser();
      await seedExistingGroup();

      const innerFileStats: InnerFileStat[] = [
        {
          fileName: 'pages-not-written.json',
          collectionName: 'pages',
          size: 1,
        },
      ];

      const report =
        await receiverService.detectImportConflicts(innerFileStats);

      expect(report.conflictsByCollection.size).toBe(0);
    });
  });

  test('leaves the destination unchanged and imports nothing while detecting', async () => {
    // Requirements 2.1, 2.4 — the gate is only non-destructive if this method itself
    // neither imports nor writes. Compare full documents, not just counts.
    await seedExistingUser();
    await seedExistingGroup();

    await writeArchiveJson('users-readonly.json', [
      {
        _id: ARCHIVE_USER_ID,
        username: EXISTING_USER.username,
        email: EXISTING_USER.email,
        slackMemberId: EXISTING_USER.slackMemberId,
      },
    ]);
    await writeArchiveJson('groups-readonly.json', [
      { _id: ARCHIVE_GROUP_ID, name: EXISTING_GROUP_NAME },
    ]);

    const innerFileStats: InnerFileStat[] = [
      { fileName: 'users-readonly.json', collectionName: 'users', size: 1 },
      {
        fileName: 'groups-readonly.json',
        collectionName: 'usergroups',
        size: 1,
      },
    ];

    const before = await snapshotDestination();

    const report = await receiverService.detectImportConflicts(innerFileStats);

    const after = await snapshotDestination();

    // Guard against a vacuous read-only check: this run must really have found something.
    expect(getUserConflicts(report)).toHaveLength(3);
    expect(getGroupConflicts(report)).toHaveLength(1);
    expect(after).toEqual(before);
    // The archive documents must not have been imported.
    expect(await User.findById(ARCHIVE_USER_ID)).toBeNull();
    expect(await UserGroup.findById(ARCHIVE_GROUP_ID)).toBeNull();
  });

  test('detects an externalaccounts unique-constraint conflict and interrupts the receive flow before anything is written', async () => {
    // Requirements 2.1, 2.2, 2.3, 3.2 — the same non-destructive gate the users/usergroups
    // tests above prove, exercised for the composite {providerType, accountId} key so that
    // externalaccounts (this spec's addition) is proven wired end-to-end into the receive
    // flow, not only unit-tested in isolation (detect-unique-conflicts.integ.ts covers the
    // detection logic itself under task 8.1).
    const existingUserId = await seedExistingUser();
    const existingExternalAccountId =
      await seedExistingExternalAccount(existingUserId);

    // Same providerType+accountId as the existing document, but a different `_id` — a
    // genuine conflict, not a re-import of the same document (requirement 1.5).
    await writeArchiveJson('externalaccounts-conflict.json', [
      {
        _id: ARCHIVE_EXTERNAL_ACCOUNT_ID,
        providerType: EXISTING_EXTERNAL_ACCOUNT.providerType,
        accountId: EXISTING_EXTERNAL_ACCOUNT.accountId,
        user: existingUserId,
      },
    ]);

    const innerFileStats: InnerFileStat[] = [
      {
        fileName: 'externalaccounts-conflict.json',
        collectionName: 'externalaccounts',
        size: 1,
      },
    ];

    const before = await snapshotDestination();

    const report = await receiverService.detectImportConflicts(innerFileStats);

    const after = await snapshotDestination();

    // Requirement 3.2 — same report shape/fields as the users/usergroups conflicts above,
    // with the composite key reported as a `field+field` label and a stringified tuple.
    expect(getExternalAccountConflicts(report)).toEqual([
      {
        collection: 'externalaccounts',
        field: 'providerType+accountId',
        value: JSON.stringify([
          EXISTING_EXTERNAL_ACCOUNT.providerType,
          EXISTING_EXTERNAL_ACCOUNT.accountId,
        ]),
        archiveId: ARCHIVE_EXTERNAL_ACCOUNT_ID,
        existingId: existingExternalAccountId,
      },
    ]);

    // Requirement 2.1/2.3 — no collection was written to at all, not just externalaccounts.
    expect(after).toEqual(before);
    // The archive document must not have been imported.
    expect(
      await ExternalAccount.findById(ARCHIVE_EXTERNAL_ACCOUNT_ID),
    ).toBeNull();
    // Requirement 2.3 — the pre-existing document is completely unchanged.
    const existingAfter = await ExternalAccount.findById(
      existingExternalAccountId,
    ).lean();
    expect(existingAfter?.providerType).toBe(
      EXISTING_EXTERNAL_ACCOUNT.providerType,
    );
    expect(existingAfter?.accountId).toBe(EXISTING_EXTERNAL_ACCOUNT.accountId);
    expect(String(existingAfter?.user)).toBe(existingUserId);
  });

  test('rejects when a declared archive file is missing from the unzipped directory', async () => {
    // A users file that is declared but unreadable must not be silently downgraded to
    // "users are not part of this transfer": that would let the import run and drop the
    // conflicting users exactly as issue #10151 does (requirement 2.3). The route turns
    // this rejection into a 5xx instead of the 409 it returns for real conflicts.
    await seedExistingUser();

    const innerFileStats: InnerFileStat[] = [
      { fileName: 'users-not-unzipped.json', collectionName: 'users', size: 1 },
    ];

    await expect(
      receiverService.detectImportConflicts(innerFileStats),
    ).rejects.toThrow();
  });
});
