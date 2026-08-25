import type { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IUser, IUserGroup } from '@growi/core';
import type { Model } from 'mongoose';
import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import ExternalUserGroup from '~/features/external-user-group/server/models/external-user-group';
import { GrowiArchiveImportOption } from '~/models/admin/growi-archive-import-option';
import { ImportMode } from '~/models/admin/import-mode';
import type Crowi from '~/server/crowi';
import {
  setupIndependentModels,
  setupModelsDependentOnCrowi,
} from '~/server/crowi/setup-models';
import type UserEvent from '~/server/events/user';
import UserGroupRelation from '~/server/models/user-group-relation';

import { G2GTransferReceiverService } from '../g2g-transfer';
import { GrowiBridgeService } from '../growi-bridge';
import type { UniqueConflictReport } from './detect-unique-conflicts';
import { detectUniqueConflicts, toLookup } from './detect-unique-conflicts';
import { ImportService } from './import';

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
const ARCHIVE_EXTERNAL_ACCOUNT_ID = '0123456789abcdef01230004';
const ARCHIVE_EXTERNAL_USER_GROUP_ID = '0123456789abcdef01230005';

// `providerType`+`accountId` is the only unique key on `externalaccounts`
// (models/external-account.ts): neither field on its own identifies a conflict.
const EXISTING_EXTERNAL_ACCOUNT = {
  providerType: 'saml',
  accountId: 'g2g-detect-existing-account-id',
} as const;

const ARCHIVE_EXTERNAL_ACCOUNT = {
  providerType: 'oidc',
  accountId: 'g2g-detect-archive-account-id',
} as const;

// `externalusergroups` has two independent unique keys
// (features/external-user-group/server/models/external-user-group.ts): the single-field
// `externalId` and the composite {name, provider}.
const EXISTING_EXTERNAL_USER_GROUP = {
  name: 'g2g-detect-existing-external-group',
  externalId: 'g2g-detect-existing-external-id',
  provider: 'ldap',
} as const;

const ARCHIVE_EXTERNAL_USER_GROUP = {
  name: 'g2g-detect-archive-external-group',
  externalId: 'g2g-detect-archive-external-id',
  provider: 'keycloak',
} as const;

/*
 * Fixtures for the conflict-free import below. One document exactly as the export service
 * writes it: the raw driver documents are JSON-stringified, so every ObjectId (`_id`,
 * `relatedUser`, `relatedGroup`) is a hex string and every Date an ISO string.
 */
type ArchiveDoc = Record<string, unknown>;

const SOURCE_USER_U = {
  _id: '0123456789abcdef01230101',
  name: 'g2g-detect import user u',
  username: 'g2g-detect-import-user-u',
  email: 'g2g-detect-import-user-u@example.com',
} satisfies ArchiveDoc;

const SOURCE_USER_V = {
  _id: '0123456789abcdef01230102',
  name: 'g2g-detect import user v',
  username: 'g2g-detect-import-user-v',
  email: 'g2g-detect-import-user-v@example.com',
} satisfies ArchiveDoc;

const SOURCE_GROUP_X = {
  _id: '0123456789abcdef01230111',
  name: 'g2g-detect-import-group-x',
} satisfies ArchiveDoc;

const SOURCE_GROUP_Y = {
  _id: '0123456789abcdef01230112',
  name: 'g2g-detect-import-group-y',
} satisfies ArchiveDoc;

// Imported but related to nobody, so an invented membership would show up as this id.
const SOURCE_GROUP_Z = {
  _id: '0123456789abcdef01230113',
  name: 'g2g-detect-import-group-z',
} satisfies ArchiveDoc;

const SOURCE_RELATION_U_X = {
  _id: '0123456789abcdef01230121',
  relatedUser: SOURCE_USER_U._id,
  relatedGroup: SOURCE_GROUP_X._id,
  createdAt: '2026-01-02T03:04:05.000Z',
} satisfies ArchiveDoc;

const SOURCE_RELATION_U_Y = {
  _id: '0123456789abcdef01230122',
  relatedUser: SOURCE_USER_U._id,
  relatedGroup: SOURCE_GROUP_Y._id,
  createdAt: '2026-01-02T03:04:05.000Z',
} satisfies ArchiveDoc;

const SOURCE_RELATION_V_Y = {
  _id: '0123456789abcdef01230123',
  relatedUser: SOURCE_USER_V._id,
  relatedGroup: SOURCE_GROUP_Y._id,
  createdAt: '2026-01-02T03:04:05.000Z',
} satisfies ArchiveDoc;

// Destination-side documents that collide with nothing in the archive. They must survive the
// import untouched and must never leak into an imported user's resolved membership.
const DESTINATION_USER = {
  name: 'g2g-detect destination admin',
  username: 'g2g-detect-destination-admin',
  email: 'g2g-detect-destination-admin@example.com',
} as const;

const DESTINATION_GROUP_NAME = 'g2g-detect-destination-group';

const OPERATOR_USER_ID = '0123456789abcdef01230131';

describe('detectUniqueConflicts', () => {
  let User: Model<IUser>;
  let UserGroup: Model<IUserGroup>;
  // `ExternalAccount` has no exported interface / default export
  // (models/external-account.ts keeps it Mongoose-registered only for index creation while
  // its behavior lives in a Prisma extension); fetched from the model registry untyped,
  // exactly like the caller (g2g-transfer.ts `detectImportConflicts`) already does.
  let ExternalAccount: Model<Record<string, unknown>>;
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

  const seedExistingExternalUserGroup = async (): Promise<string> => {
    const created = await ExternalUserGroup.create({
      ...EXISTING_EXTERNAL_USER_GROUP,
    });
    return String(created._id);
  };

  const removeFixtures = async (): Promise<void> => {
    await User.deleteMany({
      username: { $in: [EXISTING_USER.username, ARCHIVE_USER.username] },
    });
    await UserGroup.deleteMany({
      name: { $in: [EXISTING_GROUP_NAME, ARCHIVE_GROUP_NAME] },
    });
    // `externalusergroups.externalId` is a non-sparse unique index, so a document left
    // behind by a crashed run would make the next run's seed fail with E11000 — which is
    // why these run from the shared cleanup (`beforeAll` calls it once as well) rather
    // than from a nested `afterEach`.
    await ExternalAccount.deleteMany({
      $or: [
        {
          accountId: {
            $in: [
              EXISTING_EXTERNAL_ACCOUNT.accountId,
              ARCHIVE_EXTERNAL_ACCOUNT.accountId,
            ],
          },
        },
        { _id: { $in: [ARCHIVE_EXTERNAL_ACCOUNT_ID] } },
      ],
    });
    await ExternalUserGroup.deleteMany({
      $or: [
        {
          externalId: {
            $in: [
              EXISTING_EXTERNAL_USER_GROUP.externalId,
              ARCHIVE_EXTERNAL_USER_GROUP.externalId,
            ],
          },
        },
        {
          name: {
            $in: [
              EXISTING_EXTERNAL_USER_GROUP.name,
              ARCHIVE_EXTERNAL_USER_GROUP.name,
            ],
          },
        },
        { _id: { $in: [ARCHIVE_EXTERNAL_USER_GROUP_ID] } },
      ],
    });
  };

  // Thin adapter over the new `CollectionInput[]`-driven signature that keeps every
  // existing users/usergroups call site in this file looking the way it did before task
  // 3.2 (a flat `{usersJsonPath, groupsJsonPath, ...}` object) instead of rewriting each
  // of the ~20 call sites into a `collections` array by hand.
  const detect = (input: {
    usersJsonPath: string | null;
    groupsJsonPath: string | null;
    userModel?: Model<IUser>;
    userGroupModel?: Model<IUserGroup>;
    replaceTargetCollections?: ReadonlySet<string>;
  }): Promise<UniqueConflictReport> => {
    const {
      usersJsonPath,
      groupsJsonPath,
      userModel = User,
      userGroupModel = UserGroup,
      replaceTargetCollections,
    } = input;

    return detectUniqueConflicts({
      collections: [
        {
          collection: 'users',
          jsonPath: usersJsonPath,
          lookup: toLookup(userModel),
        },
        {
          collection: 'usergroups',
          jsonPath: groupsJsonPath,
          lookup: toLookup(userGroupModel),
        },
      ],
      replaceTargetCollections,
    });
  };

  // A skipped collection (`jsonPath: null`, or excluded by `replaceTargetCollections`) has
  // no entry in `conflictsByCollection` (see detect-unique-conflicts.ts `isActive`), so
  // reading through these normalises "not part of this transfer" and "part of it with zero
  // conflicts" to the same `[]` for assertions that do not care about the distinction.
  const getUserConflicts = (report: UniqueConflictReport): readonly unknown[] =>
    report.conflictsByCollection.get('users') ?? [];
  const getGroupConflicts = (
    report: UniqueConflictReport,
  ): readonly unknown[] => report.conflictsByCollection.get('usergroups') ?? [];

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
    // `setupIndependentModels` above imports `models/external-account`, which is what
    // registers this schema; without it the registry lookup throws MissingSchemaError.
    ExternalAccount = mongoose.model('ExternalAccount');

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

      const report = await detect({
        usersJsonPath,
        groupsJsonPath: null,
        userModel: User,
        userGroupModel: UserGroup,
      });

      expect(getUserConflicts(report)).toEqual([
        {
          collection: 'users',
          field: 'username',
          value: EXISTING_USER.username,
          archiveId: ARCHIVE_USER_ID,
          existingId,
        },
      ]);
      expect(getGroupConflicts(report)).toEqual([]);
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

      const report = await detect({
        usersJsonPath,
        groupsJsonPath: null,
        userModel: User,
        userGroupModel: UserGroup,
      });

      expect(getUserConflicts(report)).toEqual([
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

      const report = await detect({
        usersJsonPath,
        groupsJsonPath: null,
        userModel: User,
        userGroupModel: UserGroup,
      });

      expect(getUserConflicts(report)).toEqual([
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

      const report = await detect({
        usersJsonPath,
        groupsJsonPath: null,
        userModel: User,
        userGroupModel: UserGroup,
      });

      expect(getUserConflicts(report)).toEqual([]);
      expect(getGroupConflicts(report)).toEqual([]);
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

      const report = await detect({
        usersJsonPath,
        groupsJsonPath: null,
        userModel: User,
        userGroupModel: UserGroup,
      });

      expect(getUserConflicts(report)).toEqual([]);
      expect(getGroupConflicts(report)).toEqual([]);
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

      const report = await detect({
        usersJsonPath,
        groupsJsonPath: null,
        userModel: User,
        userGroupModel: UserGroup,
      });

      expect(getUserConflicts(report)).toEqual([]);
      expect(getGroupConflicts(report)).toEqual([]);
    });

    test('reports no conflict for an archive that contains no documents', async () => {
      await seedExistingUser();
      const usersJsonPath = await writeArchiveJson('users-empty.json', []);

      const report = await detect({
        usersJsonPath,
        groupsJsonPath: null,
        userModel: User,
        userGroupModel: UserGroup,
      });

      expect(getUserConflicts(report)).toEqual([]);
      expect(getGroupConflicts(report)).toEqual([]);
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

      const report = await detect({
        usersJsonPath: null,
        groupsJsonPath,
        userModel: User,
        userGroupModel: UserGroup,
      });

      expect(getGroupConflicts(report)).toEqual([
        {
          collection: 'usergroups',
          field: 'name',
          value: EXISTING_GROUP_NAME,
          archiveId: ARCHIVE_GROUP_ID,
          existingId,
        },
      ]);
      expect(getUserConflicts(report)).toEqual([]);
    });

    test('reports no conflict when the archive group is the same document (same _id) as the existing group', async () => {
      // Requirement 1.5
      const existingId = await seedExistingGroup();
      const groupsJsonPath = await writeArchiveJson('usergroups-same-id.json', [
        { _id: existingId, name: EXISTING_GROUP_NAME },
      ]);

      const report = await detect({
        usersJsonPath: null,
        groupsJsonPath,
        userModel: User,
        userGroupModel: UserGroup,
      });

      expect(getGroupConflicts(report)).toEqual([]);
    });
  });

  /*
   * Requirements 5.3, 5.4 — the two collections whose unique constraints are composite.
   *
   * These run through the whole `detectUniqueConflicts` orchestrator against the real
   * replica set, which is what the unit-level `collectConflicts` tests cannot cover: the
   * composite key is looked up with an `$or` of exact-match conditions
   * (`buildLookupFilters`), so whether a partial match is a conflict is decided by what
   * MongoDB actually returns for that filter, not by the pure comparison alone.
   */
  describe('externalaccounts and externalusergroups collections', () => {
    // Block-local mirror of the top-level `detect` helper: both external collections are
    // listed on every call, with `jsonPath: null` for the one not under test.
    const detectExternal = (input: {
      accountsJsonPath: string | null;
      groupsJsonPath: string | null;
    }): Promise<UniqueConflictReport> =>
      detectUniqueConflicts({
        collections: [
          {
            collection: 'externalaccounts',
            jsonPath: input.accountsJsonPath,
            lookup: toLookup(ExternalAccount),
          },
          {
            collection: 'externalusergroups',
            jsonPath: input.groupsJsonPath,
            lookup: toLookup(ExternalUserGroup),
          },
        ],
      });

    const getAccountConflicts = (
      report: UniqueConflictReport,
    ): readonly unknown[] =>
      report.conflictsByCollection.get('externalaccounts') ?? [];
    const getExternalGroupConflicts = (
      report: UniqueConflictReport,
    ): readonly unknown[] =>
      report.conflictsByCollection.get('externalusergroups') ?? [];

    test('detects a providerType+accountId conflict when the archive account shares both values under a different _id', async () => {
      // Requirement 1.7, 5.3
      const userId = await seedExistingUser();
      const existingId = await seedExistingExternalAccount(userId);
      const accountsJsonPath = await writeArchiveJson(
        'externalaccounts-composite-conflict.json',
        [
          {
            _id: ARCHIVE_EXTERNAL_ACCOUNT_ID,
            providerType: EXISTING_EXTERNAL_ACCOUNT.providerType,
            accountId: EXISTING_EXTERNAL_ACCOUNT.accountId,
            user: ARCHIVE_USER_ID,
          },
        ],
      );

      const report = await detectExternal({
        accountsJsonPath,
        groupsJsonPath: null,
      });

      expect(getAccountConflicts(report)).toEqual([
        {
          collection: 'externalaccounts',
          field: 'providerType+accountId',
          // A composite key reports the value tuple, not a bare field value
          // (`toReportedValue`), so the operator can tell which value belongs to which field.
          value: JSON.stringify([
            EXISTING_EXTERNAL_ACCOUNT.providerType,
            EXISTING_EXTERNAL_ACCOUNT.accountId,
          ]),
          archiveId: ARCHIVE_EXTERNAL_ACCOUNT_ID,
          existingId,
        },
      ]);
      expect(getExternalGroupConflicts(report)).toEqual([]);
    });

    test('reports no conflict when only providerType matches and accountId differs', async () => {
      // Requirement 1.10, 5.3 — half of a composite key is not a unique-index violation.
      const userId = await seedExistingUser();
      await seedExistingExternalAccount(userId);
      const accountsJsonPath = await writeArchiveJson(
        'externalaccounts-provider-only.json',
        [
          {
            _id: ARCHIVE_EXTERNAL_ACCOUNT_ID,
            providerType: EXISTING_EXTERNAL_ACCOUNT.providerType,
            accountId: ARCHIVE_EXTERNAL_ACCOUNT.accountId,
            user: ARCHIVE_USER_ID,
          },
        ],
      );

      const report = await detectExternal({
        accountsJsonPath,
        groupsJsonPath: null,
      });

      expect(getAccountConflicts(report)).toEqual([]);
    });

    test('reports no conflict when only accountId matches and providerType differs', async () => {
      // Requirement 1.10, 5.3 — the mirror image of the case above: the same account id
      // registered against a different identity provider is a different account.
      const userId = await seedExistingUser();
      await seedExistingExternalAccount(userId);
      const accountsJsonPath = await writeArchiveJson(
        'externalaccounts-account-only.json',
        [
          {
            _id: ARCHIVE_EXTERNAL_ACCOUNT_ID,
            providerType: ARCHIVE_EXTERNAL_ACCOUNT.providerType,
            accountId: EXISTING_EXTERNAL_ACCOUNT.accountId,
            user: ARCHIVE_USER_ID,
          },
        ],
      );

      const report = await detectExternal({
        accountsJsonPath,
        groupsJsonPath: null,
      });

      expect(getAccountConflicts(report)).toEqual([]);
    });

    test('reports no conflict when the archive account is the same document (same _id) as the existing account', async () => {
      // Requirement 1.5, 5.3 — re-importing the same document.
      const userId = await seedExistingUser();
      const existingId = await seedExistingExternalAccount(userId);
      const accountsJsonPath = await writeArchiveJson(
        'externalaccounts-same-id.json',
        [
          {
            _id: existingId,
            providerType: EXISTING_EXTERNAL_ACCOUNT.providerType,
            accountId: EXISTING_EXTERNAL_ACCOUNT.accountId,
            user: userId,
          },
        ],
      );

      const report = await detectExternal({
        accountsJsonPath,
        groupsJsonPath: null,
      });

      expect(getAccountConflicts(report)).toEqual([]);
    });

    test('detects an externalId conflict when the archive group shares the externalId under a different _id', async () => {
      // Requirement 1.8, 5.4 — `name` and `provider` deliberately differ from the seeded
      // group, so the single-field `externalId` key is the only one that can fire and the
      // conflict below names which key matched.
      const existingId = await seedExistingExternalUserGroup();
      const groupsJsonPath = await writeArchiveJson(
        'externalusergroups-external-id.json',
        [
          {
            _id: ARCHIVE_EXTERNAL_USER_GROUP_ID,
            name: ARCHIVE_EXTERNAL_USER_GROUP.name,
            externalId: EXISTING_EXTERNAL_USER_GROUP.externalId,
            provider: ARCHIVE_EXTERNAL_USER_GROUP.provider,
          },
        ],
      );

      const report = await detectExternal({
        accountsJsonPath: null,
        groupsJsonPath,
      });

      expect(getExternalGroupConflicts(report)).toEqual([
        {
          collection: 'externalusergroups',
          field: 'externalId',
          // A single-field key reports the bare value (`toReportedValue`).
          value: EXISTING_EXTERNAL_USER_GROUP.externalId,
          archiveId: ARCHIVE_EXTERNAL_USER_GROUP_ID,
          existingId,
        },
      ]);
      expect(getAccountConflicts(report)).toEqual([]);
    });

    test('detects a name+provider conflict when the archive group shares both values under a different _id', async () => {
      // Requirement 1.9, 5.4 — `externalId` deliberately differs, so the composite
      // {name, provider} key is the only one that can fire.
      const existingId = await seedExistingExternalUserGroup();
      const groupsJsonPath = await writeArchiveJson(
        'externalusergroups-name-provider.json',
        [
          {
            _id: ARCHIVE_EXTERNAL_USER_GROUP_ID,
            name: EXISTING_EXTERNAL_USER_GROUP.name,
            externalId: ARCHIVE_EXTERNAL_USER_GROUP.externalId,
            provider: EXISTING_EXTERNAL_USER_GROUP.provider,
          },
        ],
      );

      const report = await detectExternal({
        accountsJsonPath: null,
        groupsJsonPath,
      });

      expect(getExternalGroupConflicts(report)).toEqual([
        {
          collection: 'externalusergroups',
          field: 'name+provider',
          value: JSON.stringify([
            EXISTING_EXTERNAL_USER_GROUP.name,
            EXISTING_EXTERNAL_USER_GROUP.provider,
          ]),
          archiveId: ARCHIVE_EXTERNAL_USER_GROUP_ID,
          existingId,
        },
      ]);
    });

    test('reports no conflict when neither externalId nor name+provider overlaps with the destination', async () => {
      // Requirement 5.4 — the clean case both keys must let through.
      await seedExistingExternalUserGroup();
      const groupsJsonPath = await writeArchiveJson(
        'externalusergroups-no-overlap.json',
        [
          {
            _id: ARCHIVE_EXTERNAL_USER_GROUP_ID,
            ...ARCHIVE_EXTERNAL_USER_GROUP,
          },
        ],
      );

      const report = await detectExternal({
        accountsJsonPath: null,
        groupsJsonPath,
      });

      expect(getExternalGroupConflicts(report)).toEqual([]);
    });

    test('reports no conflict when the archive group is the same document (same _id) as the existing group', async () => {
      // Requirement 1.5, 5.4 — re-importing the same document. Here both keys match, so
      // this is also the case that proves the same-`_id` exclusion applies per key rather
      // than to whichever key happens to be evaluated first.
      const existingId = await seedExistingExternalUserGroup();
      const groupsJsonPath = await writeArchiveJson(
        'externalusergroups-same-id.json',
        [{ _id: existingId, ...EXISTING_EXTERNAL_USER_GROUP }],
      );

      const report = await detectExternal({
        accountsJsonPath: null,
        groupsJsonPath,
      });

      expect(getExternalGroupConflicts(report)).toEqual([]);
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

      const report = await detect({
        usersJsonPath: null,
        groupsJsonPath,
        userModel: User,
        userGroupModel: UserGroup,
      });

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

      const report = await detect({
        usersJsonPath,
        groupsJsonPath: null,
        userModel: User,
        userGroupModel: UserGroup,
      });

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

    test('returns an empty report without throwing when neither collection is part of the transfer', async () => {
      // Requirement 1.6
      await seedExistingUser();
      await seedExistingGroup();

      const report = await detect({
        usersJsonPath: null,
        groupsJsonPath: null,
        userModel: User,
        userGroupModel: UserGroup,
      });

      expect(getUserConflicts(report)).toEqual([]);
      expect(getGroupConflicts(report)).toEqual([]);
    });

    // A lookup that must never be called: if `detectUniqueConflicts` ever tried to detect a
    // collection whose `CollectionInput` was omitted or given `jsonPath: null`, calling this
    // would be the first observable symptom, well before any DB round trip.
    const unreachableLookup = () => {
      throw new Error('lookup must not be called for a skipped collection');
    };

    test('skips each of the 4 collections in turn without throwing, while the remaining collections still detect normally', async () => {
      // Requirement 1.6 — extended to all 4 declared collections (task 3.2). `externalaccounts`
      // and `externalusergroups` are exercised here only for the skip path: their own
      // detection behaviour (composite-key matching against a real destination) is covered by
      // task 8.1/8.2, out of this task's boundary. A never-called `unreachableLookup` is
      // sufficient evidence that the skip is real, not merely that the lookup returned empty.
      const existingId = await seedExistingUser();
      const existingGroupId = await seedExistingGroup();
      const usersJsonPath = await writeArchiveJson(
        'users-four-collection-skip.json',
        [
          {
            _id: ARCHIVE_USER_ID,
            username: EXISTING_USER.username,
            email: ARCHIVE_USER.email,
            slackMemberId: ARCHIVE_USER.slackMemberId,
          },
        ],
      );
      const groupsJsonPath = await writeArchiveJson(
        'usergroups-four-collection-skip.json',
        [{ _id: ARCHIVE_GROUP_ID, name: EXISTING_GROUP_NAME }],
      );

      // Case 1: only `users` is part of the transfer.
      const usersOnlyReport = await detectUniqueConflicts({
        collections: [
          {
            collection: 'users',
            jsonPath: usersJsonPath,
            lookup: toLookup(User),
          },
          {
            collection: 'usergroups',
            jsonPath: null,
            lookup: unreachableLookup,
          },
          {
            collection: 'externalaccounts',
            jsonPath: null,
            lookup: unreachableLookup,
          },
          {
            collection: 'externalusergroups',
            jsonPath: null,
            lookup: unreachableLookup,
          },
        ],
      });
      expect(usersOnlyReport.conflictsByCollection.get('users')).toEqual([
        {
          collection: 'users',
          field: 'username',
          value: EXISTING_USER.username,
          archiveId: ARCHIVE_USER_ID,
          existingId,
        },
      ]);
      expect(
        usersOnlyReport.conflictsByCollection.get('usergroups'),
      ).toBeUndefined();
      expect(
        usersOnlyReport.conflictsByCollection.get('externalaccounts'),
      ).toBeUndefined();
      expect(
        usersOnlyReport.conflictsByCollection.get('externalusergroups'),
      ).toBeUndefined();

      // Case 2: only `usergroups` is part of the transfer — the mirror image of case 1, so
      // `users` being skipped does not depend on it happening to be listed first.
      const groupsOnlyReport = await detectUniqueConflicts({
        collections: [
          { collection: 'users', jsonPath: null, lookup: unreachableLookup },
          {
            collection: 'usergroups',
            jsonPath: groupsJsonPath,
            lookup: toLookup(UserGroup),
          },
          {
            collection: 'externalaccounts',
            jsonPath: null,
            lookup: unreachableLookup,
          },
          {
            collection: 'externalusergroups',
            jsonPath: null,
            lookup: unreachableLookup,
          },
        ],
      });
      expect(
        groupsOnlyReport.conflictsByCollection.get('users'),
      ).toBeUndefined();
      expect(groupsOnlyReport.conflictsByCollection.get('usergroups')).toEqual([
        {
          collection: 'usergroups',
          field: 'name',
          value: EXISTING_GROUP_NAME,
          archiveId: ARCHIVE_GROUP_ID,
          existingId: existingGroupId,
        },
      ]);

      // Case 3: none of the 4 collections is part of the transfer at all.
      const noneReport = await detectUniqueConflicts({
        collections: [
          { collection: 'users', jsonPath: null, lookup: unreachableLookup },
          {
            collection: 'usergroups',
            jsonPath: null,
            lookup: unreachableLookup,
          },
          {
            collection: 'externalaccounts',
            jsonPath: null,
            lookup: unreachableLookup,
          },
          {
            collection: 'externalusergroups',
            jsonPath: null,
            lookup: unreachableLookup,
          },
        ],
      });
      expect(noneReport.conflictsByCollection.size).toBe(0);
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

      const report = await detect({
        usersJsonPath,
        groupsJsonPath,
        userModel: User,
        userGroupModel: UserGroup,
      });

      const after = await snapshotDestination();

      // Guard against a vacuous read-only check: this run must really have found something.
      expect(getUserConflicts(report)).toHaveLength(3);
      expect(getGroupConflicts(report)).toHaveLength(1);
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
        detect({
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
        detect({
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
        detect({
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
        detect({
          usersJsonPath,
          groupsJsonPath: null,
          userModel: User,
          userGroupModel: UserGroup,
        }),
      ).rejects.toThrow();
    });

    test('rejects when the archive JSON file does not exist', async () => {
      await expect(
        detect({
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
        detect({
          usersJsonPath,
          groupsJsonPath: null,
          userModel: failingUserModel,
          userGroupModel: UserGroup,
        }),
      ).rejects.toThrow('lookup exploded');
    });
  });

  /*
   * Requirements 4.1, 4.2, 5.2 — non-regression for the conflict-free path.
   *
   * This block goes one step past detection: it runs the REAL ImportService over the three
   * collections that decide group access (users / usergroups / usergrouprelations) with the
   * import settings the G2G receiver itself builds, then reads the destination back through
   * `UserGroupRelation.findAllUserGroupIdsRelatedToUser` — the lookup the page-viewability
   * check (`PageQueryBuilder` / `grantedGroups.item`, which this spec does not touch) feeds
   * from. So "the group-public page stays viewable" is asserted as what it reduces to: the
   * three documents landing under their source `_id`s and the membership resolving to the
   * source's group ids.
   *
   * Issue #10151 is the case where the users insert is silently dropped, leaving the relation
   * pointing at a user that does not exist and that lookup returning nothing. Here nothing
   * collides, so the gate must let the transfer through and the three must line up.
   */
  describe('group access after a conflict-free import', () => {
    // The three collections whose consistent import is what group access reduces to.
    const ARCHIVE_COLLECTIONS = [
      'users',
      'usergroups',
      'usergrouprelations',
    ] as const;
    type ArchiveCollectionName = (typeof ARCHIVE_COLLECTIONS)[number];

    const ALL_USERNAMES = [
      SOURCE_USER_U.username,
      SOURCE_USER_V.username,
      DESTINATION_USER.username,
    ];
    const ALL_GROUP_NAMES = [
      SOURCE_GROUP_X.name,
      SOURCE_GROUP_Y.name,
      SOURCE_GROUP_Z.name,
      DESTINATION_GROUP_NAME,
    ];
    const ARCHIVE_USER_IDS = [SOURCE_USER_U._id, SOURCE_USER_V._id];
    const ARCHIVE_GROUP_IDS = [
      SOURCE_GROUP_X._id,
      SOURCE_GROUP_Y._id,
      SOURCE_GROUP_Z._id,
    ];
    const ARCHIVE_RELATION_IDS = [
      SOURCE_RELATION_U_X._id,
      SOURCE_RELATION_U_Y._id,
      SOURCE_RELATION_V_Y._id,
    ];

    let importsDir: string;
    let importService: ImportService;
    let receiverService: G2GTransferReceiverService;

    // The name the export service gives an inner file.
    const archiveFileName = (collectionName: ArchiveCollectionName): string =>
      `${collectionName}.json`;

    const archivePath = (collectionName: ArchiveCollectionName): string =>
      path.join(importsDir, archiveFileName(collectionName));

    const writeArchive = async (
      docsByCollection: Readonly<
        Record<ArchiveCollectionName, readonly ArchiveDoc[]>
      >,
    ): Promise<void> => {
      await Promise.all(
        ARCHIVE_COLLECTIONS.map((collectionName) =>
          fs.writeFile(
            archivePath(collectionName),
            JSON.stringify(docsByCollection[collectionName]),
            'utf-8',
          ),
        ),
      );
    };

    const detectConflicts = () =>
      detect({
        usersJsonPath: archivePath('users'),
        groupsJsonPath: archivePath('usergroups'),
        userModel: User,
        userGroupModel: UserGroup,
      });

    // The receiver builds the settings every real transfer runs with, so reusing it is what
    // makes this a non-regression check of the actual G2G defaults instead of a hand-written
    // approximation that could drift from them.
    const buildImportSettingMap = () =>
      receiverService.getImportSettingMap(
        ARCHIVE_COLLECTIONS.map((collectionName) => ({
          fileName: archiveFileName(collectionName),
          collectionName,
        })),
        Object.fromEntries(
          ARCHIVE_COLLECTIONS.map((collectionName) => [
            collectionName,
            new GrowiArchiveImportOption(collectionName, ImportMode.insert),
          ]),
        ),
        OPERATOR_USER_ID,
      );

    const runImport = async (): Promise<void> => {
      await importService.import(
        [...ARCHIVE_COLLECTIONS],
        buildImportSettingMap(),
      );
    };

    const seedDestination = async (): Promise<{
      userId: string;
      groupId: string;
    }> => {
      const user = await User.create({ ...DESTINATION_USER });
      const group = await UserGroup.create({ name: DESTINATION_GROUP_NAME });
      await UserGroupRelation.create({
        relatedUser: user._id,
        relatedGroup: group._id,
      });
      return { userId: String(user._id), groupId: String(group._id) };
    };

    // Reading the document back — and failing loudly when it is missing — is what makes these
    // tests detect the issue #10151 mechanism. Resolving the membership from a synthesised
    // `{ _id }` instead would still pass with the user document absent.
    const findUserOrFail = async (id: string) => {
      const user = await User.findById(id);
      if (user == null) {
        throw new Error(`User ${id} is not in the destination`);
      }
      return user;
    };

    const findGroupOrFail = async (id: string) => {
      const group = await UserGroup.findById(id);
      if (group == null) {
        throw new Error(`UserGroup ${id} is not in the destination`);
      }
      return group;
    };

    // The order the lookup returns ids in is not part of its contract, so compare as sets.
    const resolveRelatedGroupIds = async (user: {
      _id: unknown;
    }): Promise<string[]> => {
      const groupIds =
        await UserGroupRelation.findAllUserGroupIdsRelatedToUser(user);
      return groupIds.map(String).sort();
    };

    const removeImportFixtures = async (): Promise<void> => {
      const users = await User.find({
        username: { $in: ALL_USERNAMES },
      }).select('_id');
      const groups = await UserGroup.find({
        name: { $in: ALL_GROUP_NAMES },
      }).select('_id');
      // Relations first: they are located through the documents they point at.
      await UserGroupRelation.deleteMany({
        $or: [
          { relatedUser: { $in: users.map((user) => user._id) } },
          { relatedGroup: { $in: groups.map((group) => group._id) } },
          { _id: { $in: ARCHIVE_RELATION_IDS } },
        ],
      });
      // Belt and braces on the archive ids: a document imported under one of them must never
      // leak into the next test even if its unique fields somehow differ from the fixtures.
      await User.deleteMany({
        _id: { $in: [...users.map((user) => user._id), ...ARCHIVE_USER_IDS] },
      });
      await UserGroup.deleteMany({
        _id: {
          $in: [...groups.map((group) => group._id), ...ARCHIVE_GROUP_IDS],
        },
      });
      // Each test writes the archive it expects, and a successful import unlinks the files it
      // consumed, so leftovers from a previous test must not satisfy the next one.
      const leftovers = await fs.readdir(importsDir);
      await Promise.all(
        leftovers.map((fileName) => fs.rm(path.join(importsDir, fileName))),
      );
    };

    beforeAll(async () => {
      // ImportService resolves `jsonFileName` against `<crowi.tmpDir>/imports`, the directory
      // the receive route unzips the archive into, and reports progress on `events.admin`.
      importsDir = path.join(tmpDir, 'imports');
      await fs.mkdir(importsDir, { recursive: true });

      // PageEvent / AdminEvent are typed 'any' in the Crowi interface
      const crowi = mock<Crowi>({
        tmpDir,
        events: {
          page: mock<EventEmitter>(),
          user: mock<UserEvent>(),
          admin: mock<EventEmitter>(),
        },
      });
      crowi.growiBridgeService = new GrowiBridgeService(crowi);

      // Production reaches this same class through `getImportService()`; instantiating it here
      // leaves the process-wide singleton alone. The receiver's `importCollections` wrapper is
      // deliberately not used: it additionally rewrites the destination's file-upload configs,
      // which group access does not depend on.
      importService = new ImportService(crowi);
      receiverService = new G2GTransferReceiverService(crowi);

      await removeImportFixtures();
    });

    afterEach(async () => {
      await removeImportFixtures();
    });

    test('builds `insert` settings with no overwrite params for the three collections', () => {
      // Requirement (b) of the project description: `insert` is the mode whose unique-index
      // violations `execUnorderedBulkOpSafely` swallows, so it is the mode under which "no
      // conflict ⇒ nothing is dropped" is worth pinning. Under `upsert` the archive documents
      // would overwrite by `_id` and the issue mechanism would not apply at all.
      // Empty overwrite params matter just as much: they are what leaves `_id` alone, which is
      // the whole premise of the id flow the two tests below check.
      const importSettingsMap = buildImportSettingMap();

      for (const collectionName of ARCHIVE_COLLECTIONS) {
        expect(importSettingsMap.get(collectionName)).toEqual({
          mode: ImportMode.insert,
          jsonFileName: archiveFileName(collectionName),
          overwriteParams: {},
        });
      }
    });

    test('falls back to `insert` for a collection the source sent no option for', () => {
      // The map above states the mode the source UI sends; this states the receiver's own
      // default, so the premise survives a source that omits the option entirely.
      const importSettingsMap = receiverService.getImportSettingMap(
        ARCHIVE_COLLECTIONS.map((collectionName) => ({
          fileName: archiveFileName(collectionName),
          collectionName,
        })),
        {},
        OPERATOR_USER_ID,
      );

      for (const collectionName of ARCHIVE_COLLECTIONS) {
        expect(importSettingsMap.get(collectionName)?.mode).toBe(
          ImportMode.insert,
        );
      }
    });

    test('relates the imported user to the imported group exactly as the source did', async () => {
      // Requirements 4.1, 4.2, 5.2 — the issue #10151 shape with nothing colliding: user U,
      // group X and the relation between them, against a destination that already holds its
      // own (non-colliding) user, group and relation.
      const destination = await seedDestination();

      await writeArchive({
        users: [SOURCE_USER_U],
        usergroups: [SOURCE_GROUP_X],
        usergrouprelations: [SOURCE_RELATION_U_X],
      });

      // The gate must let this transfer through: nothing collides with the destination.
      const conflictFreeReport = await detectConflicts();
      expect(getUserConflicts(conflictFreeReport)).toEqual([]);
      expect(getGroupConflicts(conflictFreeReport)).toEqual([]);

      await runImport();

      // All three landed under their source `_id`s, which is what keeps a page carrying
      // `grantedGroups.item = SOURCE_GROUP_X._id` reachable at all.
      const importedUser = await findUserOrFail(SOURCE_USER_U._id);
      expect(importedUser.username).toBe(SOURCE_USER_U.username);
      expect((await findGroupOrFail(SOURCE_GROUP_X._id)).name).toBe(
        SOURCE_GROUP_X.name,
      );

      expect(await resolveRelatedGroupIds(importedUser)).toEqual([
        SOURCE_GROUP_X._id,
      ]);

      // An `insert` import adds; the destination's own membership keeps resolving as before.
      const destinationUser = await findUserOrFail(destination.userId);
      expect(await resolveRelatedGroupIds(destinationUser)).toEqual([
        destination.groupId,
      ]);
    });

    test('resolves the exact group set for a user that belongs to several groups', async () => {
      // Requirement 4.1 — "the same correspondence as the source" has to hold in both
      // directions: no membership lost and none invented. U belongs to X and Y, V to Y only,
      // Z is imported but related to nobody, and the destination has a group of its own.
      const destination = await seedDestination();

      await writeArchive({
        users: [SOURCE_USER_U, SOURCE_USER_V],
        usergroups: [SOURCE_GROUP_X, SOURCE_GROUP_Y, SOURCE_GROUP_Z],
        usergrouprelations: [
          SOURCE_RELATION_U_X,
          SOURCE_RELATION_U_Y,
          SOURCE_RELATION_V_Y,
        ],
      });

      const conflictFreeReport = await detectConflicts();
      expect(getUserConflicts(conflictFreeReport)).toEqual([]);
      expect(getGroupConflicts(conflictFreeReport)).toEqual([]);

      await runImport();

      const importedUserU = await findUserOrFail(SOURCE_USER_U._id);
      const importedUserV = await findUserOrFail(SOURCE_USER_V._id);

      const groupIdsOfU = await resolveRelatedGroupIds(importedUserU);
      expect(groupIdsOfU).toHaveLength(2);
      expect(groupIdsOfU).toEqual(
        [SOURCE_GROUP_X._id, SOURCE_GROUP_Y._id].sort(),
      );
      expect(await resolveRelatedGroupIds(importedUserV)).toEqual([
        SOURCE_GROUP_Y._id,
      ]);

      // Group Z and the destination's group really exist, so their absence from U's set above
      // is a membership fact rather than a missing document.
      expect((await findGroupOrFail(SOURCE_GROUP_Z._id)).name).toBe(
        SOURCE_GROUP_Z.name,
      );
      expect((await findGroupOrFail(destination.groupId)).name).toBe(
        DESTINATION_GROUP_NAME,
      );
    });
  });

  describe('external auth access after a conflict-free import', () => {
    // Mirrors 'group access after a conflict-free import' above (same seed/detect/import/
    // resolve shape), but for the two collections this feature adds: externalaccounts and
    // externalusergroups. `users` is included because ExternalAccount.user is a required ref
    // and the point of Requirement 4.1 is that the ref keeps resolving to the imported user.
    const ARCHIVE_COLLECTIONS = [
      'users',
      'externalaccounts',
      'externalusergroups',
    ] as const;
    type ExtAuthArchiveCollectionName = (typeof ARCHIVE_COLLECTIONS)[number];

    const SOURCE_EXTAUTH_USER = {
      _id: '0123456789abcdef01230201',
      name: 'g2g-detect extauth import user',
      username: 'g2g-detect-extauth-import-user',
      email: 'g2g-detect-extauth-import-user@example.com',
    } satisfies ArchiveDoc;

    const SOURCE_EXTAUTH_ACCOUNT = {
      _id: '0123456789abcdef01230202',
      providerType: 'oidc',
      accountId: 'g2g-detect-extauth-import-account-id',
      user: SOURCE_EXTAUTH_USER._id,
    } satisfies ArchiveDoc;

    const SOURCE_EXTAUTH_GROUP = {
      _id: '0123456789abcdef01230203',
      name: 'g2g-detect-extauth-import-external-group',
      externalId: 'g2g-detect-extauth-import-external-id',
      provider: 'keycloak',
    } satisfies ArchiveDoc;

    // Destination-side documents that collide with nothing in the archive above: they must
    // survive the import untouched, proving the insert did not clobber existing SSO/LDAP
    // bindings.
    const DESTINATION_EXTAUTH_USER = {
      name: 'g2g-detect extauth destination user',
      username: 'g2g-detect-extauth-destination-user',
      email: 'g2g-detect-extauth-destination-user@example.com',
    } as const;
    const DESTINATION_EXTAUTH_ACCOUNT = {
      providerType: 'saml',
      accountId: 'g2g-detect-extauth-destination-account-id',
    } as const;
    const DESTINATION_EXTAUTH_GROUP = {
      name: 'g2g-detect-extauth-destination-external-group',
      externalId: 'g2g-detect-extauth-destination-external-id',
      provider: 'ldap',
    } as const;

    let extAuthImportsDir: string;
    let extAuthImportService: ImportService;
    let extAuthReceiverService: G2GTransferReceiverService;

    const archiveFileName = (
      collectionName: ExtAuthArchiveCollectionName,
    ): string => `${collectionName}.json`;

    const archivePath = (
      collectionName: ExtAuthArchiveCollectionName,
    ): string => path.join(extAuthImportsDir, archiveFileName(collectionName));

    const writeArchive = async (
      docsByCollection: Readonly<
        Record<ExtAuthArchiveCollectionName, readonly ArchiveDoc[]>
      >,
    ): Promise<void> => {
      await Promise.all(
        ARCHIVE_COLLECTIONS.map((collectionName) =>
          fs.writeFile(
            archivePath(collectionName),
            JSON.stringify(docsByCollection[collectionName]),
            'utf-8',
          ),
        ),
      );
    };

    // Read-only detection over the exact same archive `import()` is about to consume: the
    // gate this test proves did not falsely block a clean import.
    const detectConflicts = () =>
      detectUniqueConflicts({
        collections: [
          {
            collection: 'users',
            jsonPath: archivePath('users'),
            lookup: toLookup(User),
          },
          {
            collection: 'externalaccounts',
            jsonPath: archivePath('externalaccounts'),
            lookup: toLookup(ExternalAccount),
          },
          {
            collection: 'externalusergroups',
            jsonPath: archivePath('externalusergroups'),
            lookup: toLookup(ExternalUserGroup),
          },
        ],
      });

    const buildImportSettingMap = () =>
      extAuthReceiverService.getImportSettingMap(
        ARCHIVE_COLLECTIONS.map((collectionName) => ({
          fileName: archiveFileName(collectionName),
          collectionName,
        })),
        Object.fromEntries(
          ARCHIVE_COLLECTIONS.map((collectionName) => [
            collectionName,
            new GrowiArchiveImportOption(collectionName, ImportMode.insert),
          ]),
        ),
        OPERATOR_USER_ID,
      );

    const runImport = async (): Promise<void> => {
      await extAuthImportService.import(
        [...ARCHIVE_COLLECTIONS],
        buildImportSettingMap(),
      );
    };

    const seedDestination = async (): Promise<{
      userId: string;
      accountId: string;
      groupId: string;
    }> => {
      const user = await User.create({ ...DESTINATION_EXTAUTH_USER });
      const account = await ExternalAccount.create({
        ...DESTINATION_EXTAUTH_ACCOUNT,
        user: user._id,
      });
      const group = await ExternalUserGroup.create({
        ...DESTINATION_EXTAUTH_GROUP,
      });
      return {
        userId: String(user._id),
        accountId: String(account._id),
        groupId: String(group._id),
      };
    };

    const removeExtAuthFixtures = async (): Promise<void> => {
      await ExternalAccount.deleteMany({
        accountId: {
          $in: [
            SOURCE_EXTAUTH_ACCOUNT.accountId,
            DESTINATION_EXTAUTH_ACCOUNT.accountId,
          ],
        },
      });
      await ExternalUserGroup.deleteMany({
        $or: [
          { externalId: SOURCE_EXTAUTH_GROUP.externalId },
          { externalId: DESTINATION_EXTAUTH_GROUP.externalId },
          {
            name: {
              $in: [SOURCE_EXTAUTH_GROUP.name, DESTINATION_EXTAUTH_GROUP.name],
            },
          },
        ],
      });
      await User.deleteMany({
        username: {
          $in: [
            SOURCE_EXTAUTH_USER.username,
            DESTINATION_EXTAUTH_USER.username,
          ],
        },
      });
      const leftovers = await fs.readdir(extAuthImportsDir);
      await Promise.all(
        leftovers.map((fileName) =>
          fs.rm(path.join(extAuthImportsDir, fileName)),
        ),
      );
    };

    beforeAll(async () => {
      extAuthImportsDir = path.join(tmpDir, 'imports');
      await fs.mkdir(extAuthImportsDir, { recursive: true });

      const crowi = mock<Crowi>({
        tmpDir,
        events: {
          page: mock<EventEmitter>(),
          user: mock<UserEvent>(),
          admin: mock<EventEmitter>(),
        },
      });
      crowi.growiBridgeService = new GrowiBridgeService(crowi);

      extAuthImportService = new ImportService(crowi);
      extAuthReceiverService = new G2GTransferReceiverService(crowi);

      await removeExtAuthFixtures();
    });

    afterEach(async () => {
      await removeExtAuthFixtures();
    });

    test('resolves the imported external account to the imported user by providerType+accountId', async () => {
      // Requirements 4.1, 4.3.
      await seedDestination();

      await writeArchive({
        users: [SOURCE_EXTAUTH_USER],
        externalaccounts: [SOURCE_EXTAUTH_ACCOUNT],
        externalusergroups: [],
      });

      // The gate must let this transfer through: nothing collides with the destination.
      const conflictFreeReport = await detectConflicts();
      expect(
        conflictFreeReport.conflictsByCollection.get('externalaccounts'),
      ).toEqual([]);
      expect(
        conflictFreeReport.conflictsByCollection.get('externalusergroups'),
      ).toEqual([]);

      await runImport();

      const importedAccount = await ExternalAccount.findOne({
        providerType: SOURCE_EXTAUTH_ACCOUNT.providerType,
        accountId: SOURCE_EXTAUTH_ACCOUNT.accountId,
      });
      if (importedAccount == null) {
        throw new Error('Imported ExternalAccount was not found');
      }

      const resolvedUser = await User.findById(importedAccount.user);
      if (resolvedUser == null) {
        throw new Error('ExternalAccount.user did not resolve to a user');
      }
      expect(resolvedUser.username).toBe(SOURCE_EXTAUTH_USER.username);
    });

    test('resolves the imported external group from either externalId or name+provider', async () => {
      // Requirements 4.2, 4.3.
      await seedDestination();

      await writeArchive({
        users: [],
        externalaccounts: [],
        externalusergroups: [SOURCE_EXTAUTH_GROUP],
      });

      const conflictFreeReport = await detectConflicts();
      expect(
        conflictFreeReport.conflictsByCollection.get('externalaccounts'),
      ).toEqual([]);
      expect(
        conflictFreeReport.conflictsByCollection.get('externalusergroups'),
      ).toEqual([]);

      await runImport();

      const byExternalId = await ExternalUserGroup.findOne({
        externalId: SOURCE_EXTAUTH_GROUP.externalId,
      });
      if (byExternalId == null) {
        throw new Error(
          'Imported ExternalUserGroup was not resolvable by externalId',
        );
      }
      expect(byExternalId.name).toBe(SOURCE_EXTAUTH_GROUP.name);

      const byNameAndProvider = await ExternalUserGroup.findOne({
        name: SOURCE_EXTAUTH_GROUP.name,
        provider: SOURCE_EXTAUTH_GROUP.provider,
      });
      if (byNameAndProvider == null) {
        throw new Error(
          'Imported ExternalUserGroup was not resolvable by name+provider',
        );
      }
      expect(String(byNameAndProvider._id)).toBe(String(byExternalId._id));
    });

    test('leaves the destination account and group resolvable and unaffected by the insert', async () => {
      // Requirement 4.3 — the non-regression half: a conflict-free import must not disturb
      // what was already there.
      const destination = await seedDestination();

      await writeArchive({
        users: [SOURCE_EXTAUTH_USER],
        externalaccounts: [SOURCE_EXTAUTH_ACCOUNT],
        externalusergroups: [SOURCE_EXTAUTH_GROUP],
      });

      const conflictFreeReport = await detectConflicts();
      expect(
        conflictFreeReport.conflictsByCollection.get('externalaccounts'),
      ).toEqual([]);
      expect(
        conflictFreeReport.conflictsByCollection.get('externalusergroups'),
      ).toEqual([]);

      await runImport();

      const destinationAccount = await ExternalAccount.findById(
        destination.accountId,
      );
      if (destinationAccount == null) {
        throw new Error('Destination ExternalAccount was not found');
      }
      expect(destinationAccount.providerType).toBe(
        DESTINATION_EXTAUTH_ACCOUNT.providerType,
      );
      expect(destinationAccount.accountId).toBe(
        DESTINATION_EXTAUTH_ACCOUNT.accountId,
      );

      const destinationGroup = await ExternalUserGroup.findById(
        destination.groupId,
      );
      if (destinationGroup == null) {
        throw new Error('Destination ExternalUserGroup was not found');
      }
      expect(destinationGroup.externalId).toBe(
        DESTINATION_EXTAUTH_GROUP.externalId,
      );
    });
  });
});
