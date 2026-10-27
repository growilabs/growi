/**
 * What a migration transfer leaves behind on the destination, checked against a real
 * MongoDB (task 11.1). Three things nothing short of a real database can establish:
 *
 * 1. the destination's own users and groups are gone and the source's documents are in
 *    their place under the source's own `_id`s, even though the two sides share a
 *    `username`, an `email` and a group `name` — the collision that used to abort the
 *    transfer (requirements 2.1, 2.3);
 * 2. each imported user resolves to exactly the groups they belonged to at the source,
 *    through `UserGroupRelation.findAllUserGroupIdsRelatedToUser` — the lookup the
 *    page-viewability check feeds from (`models/page.ts`, `service/page-grant.ts`), so
 *    "the group-public page is still reachable" reduces to this set matching
 *    (requirements 2.2, 7.2);
 * 3. the one destination account that survives — the rescued administrator — can still be
 *    signed into. Both halves are asserted from values **read back out of the database**:
 *    `isPasswordValid` on a freshly re-read document (the check `LocalStrategy` performs,
 *    `service/passport.ts`), and `AccessToken.findUserIdByToken` on a plaintext token
 *    issued before the transfer. A surviving `tokenHash` proves nothing on its own — only
 *    resolving the plaintext through the real lookup does (requirements 4.2, 4.3, 4.9,
 *    7.1, 7.3).
 *
 * Everything runs through the receive route, because the guarantee is about the whole
 * procedure: the snapshot of the administrators has to be taken before the import, the
 * rescue has to be written back afterwards, and the collision has to survive the conflict
 * gate in between.
 *
 * The destination administrator's password is set through the model's own `setPassword`,
 * against a `PASSWORD_SEED` this file injects into the Crowi it builds the models with.
 * Writing a hand-computed hash instead would assert against the test's arithmetic rather
 * than against "the password this account had still works".
 *
 * These tests empty `users`, `usergroups`, `usergrouprelations` and `accesstokens`, hence
 * the `.exclusive.` file name (see vitest.workspace.mts).
 */

import { EventEmitter } from 'node:events';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IUser } from '@growi/core';
import { SCOPE, type Scope } from '@growi/core/dist/interfaces';
import archiver from 'archiver';
import express from 'express';
import mongoose, { type Model } from 'mongoose';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import { ImportMode } from '~/models/admin/import-mode';
import type Crowi from '~/server/crowi';
import {
  setupIndependentModels,
  setupModelsDependentOnCrowi,
} from '~/server/crowi/setup-models';
import type UserEvent from '~/server/events/user';
import { AccessToken } from '~/server/models/access-token';
import { UserStatus } from '~/server/models/user/conts';
import UserGroup from '~/server/models/user-group';
import UserGroupRelation from '~/server/models/user-group-relation';
import AppService from '~/server/service/app';
import { configManager } from '~/server/service/config-manager';
import instanciateExportService from '~/server/service/export';
import {
  type G2GTransferPusherService,
  G2GTransferReceiverService,
  X_GROWI_TRANSFER_KEY_HEADER_NAME,
} from '~/server/service/g2g-transfer';
import { GrowiBridgeService } from '~/server/service/growi-bridge';
import { initializeImportService } from '~/server/service/import';
import { getGrowiVersion } from '~/utils/growi-version';
import { TransferKey } from '~/utils/vo/transfer-key';

import { setup } from './g2g-transfer';
import addCustomFunctionToResponse from './response';

/** Every fixture this file writes carries it, so the clean-up can find them all. */
const FIXTURE_PREFIX = 'g2g-mig-';

/** The destination process's own seed, unchanged by the transfer (it is an env var). */
const PASSWORD_SEED = 'g2g-mig-destination-password-seed';

/** What the destination administrator signs in with, before and after the transfer. */
const DEST_ADMIN_PASSWORD = 'g2g-mig-destination-admin-password';

/**
 * The destination administrator: the account the rescue exists for. It shares both its
 * `username` and its `email` with the incoming administrator, which is the ordinary
 * migration situation — the same person runs both GROWIs.
 */
const DEST_ADMIN = {
  _id: '0123456789abcdef015a0001',
  username: `${FIXTURE_PREFIX}admin`,
  email: `${FIXTURE_PREFIX}admin@example.com`,
} as const;

/** An ordinary destination user: replaced, not rescued. */
const DEST_MEMBER = {
  _id: '0123456789abcdef015a0002',
  username: `${FIXTURE_PREFIX}member`,
  email: `${FIXTURE_PREFIX}member@example.com`,
} as const;

/** A destination group whose name an incoming group also uses. */
const DEST_GROUP = {
  _id: '0123456789abcdef015a0003',
  name: `${FIXTURE_PREFIX}shared-group-name`,
} as const;

const DEST_RELATION_ID = '0123456789abcdef015a0004';

const RESCUED_USERNAME = `${DEST_ADMIN.username}-rescued`;

const ARCHIVE_ADMIN = {
  _id: '0123456789abcdef015a0010',
  username: DEST_ADMIN.username,
  email: DEST_ADMIN.email,
  password: 'g2g-mig-source-admin-password-hash',
  admin: true,
  status: UserStatus.STATUS_ACTIVE,
} as const;

const ARCHIVE_ALICE = {
  _id: '0123456789abcdef015a0011',
  username: `${FIXTURE_PREFIX}alice`,
  email: `${FIXTURE_PREFIX}alice@example.com`,
  status: UserStatus.STATUS_ACTIVE,
} as const;

const ARCHIVE_BOB = {
  _id: '0123456789abcdef015a0012',
  username: `${FIXTURE_PREFIX}bob`,
  email: `${FIXTURE_PREFIX}bob@example.com`,
  status: UserStatus.STATUS_ACTIVE,
} as const;

/** Takes the destination group's name; only the identifiers tell the two apart. */
const ARCHIVE_GROUP_ENGINEERING = {
  _id: '0123456789abcdef015a0020',
  name: DEST_GROUP.name,
} as const;

const ARCHIVE_GROUP_SALES = {
  _id: '0123456789abcdef015a0021',
  name: `${FIXTURE_PREFIX}sales`,
} as const;

/**
 * The source's membership: alice is in two groups, bob in one. The expected destination
 * state is derived from these very documents further down, so "the same correspondence as
 * the source" is stated once and never restated as a hand-copied literal.
 */
const ARCHIVE_RELATIONS = [
  {
    _id: '0123456789abcdef015a0030',
    relatedUser: ARCHIVE_ALICE._id,
    relatedGroup: ARCHIVE_GROUP_ENGINEERING._id,
  },
  {
    _id: '0123456789abcdef015a0031',
    relatedUser: ARCHIVE_ALICE._id,
    relatedGroup: ARCHIVE_GROUP_SALES._id,
  },
  {
    _id: '0123456789abcdef015a0032',
    relatedUser: ARCHIVE_BOB._id,
    relatedGroup: ARCHIVE_GROUP_SALES._id,
  },
] as const;

const sourceGroupIdsOf = (userId: string): string[] =>
  ARCHIVE_RELATIONS.filter((relation) => relation.relatedUser === userId)
    .map((relation) => relation.relatedGroup)
    .sort();

/**
 * The four collections this file transfers, carrying the migration preset's *assignment
 * shape* — every collection in the request replaced rather than appended to — and not its
 * membership: `buildMigrationTransferPlan` assigns over the whole transferable set
 * (`configs`, `pages`, `revisions`, `externalaccounts`, …), which nothing here exercises.
 * These four are the ones the destination's access rights reduce to, plus `accesstokens`
 * because emptying it is what the token half of the rescue has to survive.
 */
const MIGRATION_COLLECTIONS = [
  'users',
  'accesstokens',
  'usergroups',
  'usergrouprelations',
] as const;

const OPERATOR_USER_ID = '0123456789abcdef015a0005';

const DESTINATION_SITE_URL = 'http://g2g-mig-destination.example.com';
const DESTINATION_FILE_UPLOAD_TYPE = 'local';

/**
 * The scope the rescued token carries. `findUserIdByToken` refuses to answer for an empty
 * required-scope list, so a token with no scope could never be shown to still work.
 */
const TOKEN_SCOPES: Scope[] = [SCOPE.READ.FEATURES.PAGE];

/**
 * The methods this file drives the destination administrator's credentials through. They
 * live on the schema rather than on `IUser`, so the model is typed with them instead of
 * the document being cast at each call site.
 */
interface UserAuthMethods {
  setPassword: (password: string) => void;
  isPasswordValid: (password: string) => boolean;
}

type UserModelWithAuth = Model<IUser, unknown, UserAuthMethods>;

type ArchiveEntry = { name: string; content: string };

describe('receive route POST / — a migration transfer replaces the destination and keeps access working', () => {
  let app: express.Application;
  let crowi: Crowi;
  let User: UserModelWithAuth;
  let tmpDir: string;
  let importsDir: string;
  let transferKeyValue: string;
  /** The plaintext of the token the destination administrator holds — never stored. */
  let destAdminPlainToken: string;

  const writeArchiveZip = async (
    zipName: string,
    entries: readonly ArchiveEntry[],
  ): Promise<string> => {
    const zipPath = path.join(tmpDir, zipName);
    const archive = archiver('zip');
    const output = createWriteStream(zipPath);
    const written = new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);
    });

    archive.pipe(output);
    archive.append(JSON.stringify({ version: getGrowiVersion() }), {
      name: 'meta.json',
    });
    for (const { name, content } of entries) {
      archive.append(content, { name });
    }
    await archive.finalize();
    await written;

    return zipPath;
  };

  /**
   * The transfer the migration preset builds: every collection it carries is emptied
   * before the archive's documents are written.
   */
  const runMigrationTransfer = async (
    zipName: string,
  ): Promise<request.Response> => {
    const zipPath = await writeArchiveZip(zipName, [
      {
        name: 'users.json',
        content: JSON.stringify([ARCHIVE_ADMIN, ARCHIVE_ALICE, ARCHIVE_BOB]),
      },
      { name: 'accesstokens.json', content: JSON.stringify([]) },
      {
        name: 'usergroups.json',
        content: JSON.stringify([
          ARCHIVE_GROUP_ENGINEERING,
          ARCHIVE_GROUP_SALES,
        ]),
      },
      {
        name: 'usergrouprelations.json',
        content: JSON.stringify(ARCHIVE_RELATIONS),
      },
    ]);

    return request(app)
      .post('/')
      .set(X_GROWI_TRANSFER_KEY_HEADER_NAME, transferKeyValue)
      .field('collections', JSON.stringify(MIGRATION_COLLECTIONS))
      .field(
        'optionsMap',
        JSON.stringify(
          Object.fromEntries(
            MIGRATION_COLLECTIONS.map((name) => [
              name,
              { mode: ImportMode.flushAndInsert },
            ]),
          ),
        ),
      )
      .field('operatorUserId', OPERATOR_USER_ID)
      .field('uploadConfigs', JSON.stringify({}))
      .attach('transferDataZipFile', zipPath);
  };

  /**
   * The lookup the page-viewability check performs, resolved from the user document that
   * is actually in the database. Passing a synthesised `{ _id }` instead would answer the
   * same even with the user document missing, which is precisely the broken state issue
   * #10151 produced. The order is not part of the lookup's contract, so compare as sets.
   */
  const resolveRelatedGroupIds = async (userId: string): Promise<string[]> => {
    const user = await User.findById(userId);
    if (user == null) {
      throw new Error(`User ${userId} is not in the destination`);
    }

    const groupIds =
      await UserGroupRelation.findAllUserGroupIdsRelatedToUser(user);
    return groupIds.map(String).sort();
  };

  /**
   * By the fixture prefix rather than by `_id`: a document left behind by an interrupted
   * run carries the same unique fields under a different `_id`, and deleting by `_id`
   * alone would leave it to collide with this run's re-insertion.
   */
  const removeFixtures = async (): Promise<void> => {
    const prefixed = new RegExp(`^${FIXTURE_PREFIX}`);

    await User.deleteMany({
      $or: [{ username: prefixed }, { email: prefixed }],
    });
    await UserGroup.deleteMany({ name: prefixed });
    await UserGroupRelation.deleteMany({});
    await AccessToken.deleteMany({});

    // `recursive`/`force` because the clean-up is the one thing that has to survive a bad
    // state: today's archives unpack to flat JSON, but a plain `rm` would throw on a
    // directory or on an entry that vanished between the listing and the removal, and
    // leave the rest of the leftovers in place.
    const leftovers = await fs.readdir(importsDir);
    await Promise.all(
      leftovers.map((fileName) =>
        fs.rm(path.join(importsDir, fileName), {
          recursive: true,
          force: true,
        }),
      ),
    );
  };

  /** The destination as it stood before the transfer. */
  const createFixtures = async (): Promise<void> => {
    const admin = new User({
      _id: DEST_ADMIN._id,
      username: DEST_ADMIN.username,
      email: DEST_ADMIN.email,
      admin: true,
      status: UserStatus.STATUS_ACTIVE,
    });
    // The schema's own hashing, so the assertion afterwards is about the password rather
    // than about a hash this file happened to compute the same way twice.
    admin.setPassword(DEST_ADMIN_PASSWORD);
    await admin.save();

    await User.create({
      _id: DEST_MEMBER._id,
      username: DEST_MEMBER.username,
      email: DEST_MEMBER.email,
      status: UserStatus.STATUS_ACTIVE,
    });

    await UserGroup.create({ _id: DEST_GROUP._id, name: DEST_GROUP.name });
    await UserGroupRelation.create({
      _id: DEST_RELATION_ID,
      relatedUser: DEST_MEMBER._id,
      relatedGroup: DEST_GROUP._id,
    });

    const { token } = await AccessToken.generateToken(
      DEST_ADMIN._id,
      new Date(Date.now() + 60 * 60 * 1000),
      TOKEN_SCOPES,
      'g2g-mig destination admin token',
    );
    destAdminPlainToken = token;

    await configManager.updateConfigs({
      'app:isMaintenanceMode': false,
      'app:siteUrl': DESTINATION_SITE_URL,
      'app:fileUploadType': DESTINATION_FILE_UPLOAD_TYPE,
    });
  };

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'g2g-migration-access-'));
    importsDir = path.join(tmpDir, 'imports');
    await fs.mkdir(importsDir, { recursive: true });

    crowi = mock<Crowi>({
      tmpDir,
      // The seed the destination process runs with. `generatePassword` hashes
      // `PASSWORD_SEED + password` (models/user/index.js), so without it the "same
      // password still works" claim would rest on an undefined seed.
      env: { PASSWORD_SEED },
      events: {
        page: mock<EventEmitter>(),
        user: mock<UserEvent>(),
        admin: new EventEmitter(),
      },
    });
    crowi.growiBridgeService = new GrowiBridgeService(crowi);
    // The real one, not a stub: the transfer closes and reopens the destination through
    // it, and a stub would let the import run against a state no deployment ever has.
    crowi.appService = new AppService(crowi);
    initializeImportService(crowi);
    instanciateExportService(crowi);

    await setupModelsDependentOnCrowi(crowi);
    await setupIndependentModels();

    User = mongoose.model<IUser, UserModelWithAuth>('User');

    const receiverService = new G2GTransferReceiverService(crowi);
    crowi.g2gTransferReceiverService = receiverService;
    crowi.g2gTransferPusherService = mock<G2GTransferPusherService>();

    await configManager.loadConfigs();
    addCustomFunctionToResponse(express);

    app = express();
    app.use(setup(crowi));

    const keyString = await receiverService.createTransferKey(
      'http://g2g-mig-source.example.com',
    );
    transferKeyValue = TransferKey.parse(keyString).key;

    // Also before the first test, not only between them: this database outlives the run,
    // so a document from an earlier, separately-run process would otherwise survive into
    // the first Arrange and fail its re-insertion.
    await removeFixtures();
  }, 120_000);

  beforeEach(async () => {
    await createFixtures();
  });

  afterEach(async () => {
    await removeFixtures();
    // The transfer rewrites the upload settings and toggles maintenance mode; put back
    // what the next test in this exclusive-database project expects to find.
    await configManager.updateConfigs({
      'app:isMaintenanceMode': false,
      'app:siteUrl': DESTINATION_SITE_URL,
      'app:fileUploadType': DESTINATION_FILE_UPLOAD_TYPE,
    });
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('replaces the destination’s users and groups with the source’s, although the two sides share a username, an e-mail address and a group name', async () => {
    const response = await runMigrationTransfer('g2g-mig-replace.growi.zip');

    // Not a 409: the collision the fixtures carry is real, and it is only harmless
    // because every colliding collection is emptied first (requirement 2.3). Asserted
    // before anything else so a transfer refused up front fails here and not on a
    // downstream symptom.
    expect(response.status).toBe(200);
    // …and nothing was dropped once the import was under way either (requirement 2.1):
    // the pre-import gate is not the only place a conflict can stop a document.
    expect(response.body.failedCollections).toEqual([]);
    expect(response.body.importAborted).toBe(false);

    // The destination's ordinary member is gone outright, and so are its group and the
    // membership that connected them.
    expect(await User.findById(DEST_MEMBER._id)).toBeNull();
    expect(await User.findOne({ username: DEST_MEMBER.username })).toBeNull();
    expect(await UserGroup.findById(DEST_GROUP._id)).toBeNull();
    expect(await UserGroupRelation.findById(DEST_RELATION_ID)).toBeNull();

    // The destination's administrator no longer holds the username it had — the incoming
    // administrator took it, and the rescue put the account back under a name of its own.
    // Its `_id` survives on purpose, so that check belongs to the rescue test below
    // (requirement 4.3), not here.
    const userUnderSharedUsername = await User.findOne({
      username: DEST_ADMIN.username,
    }).lean<{ _id: unknown } | null>();
    expect(String(userUnderSharedUsername?._id)).toBe(ARCHIVE_ADMIN._id);

    // The source's documents are in their place, under the source's own identifiers —
    // which is what makes the relations between them resolve without any re-mapping.
    const importedUsers = await Promise.all(
      [ARCHIVE_ADMIN, ARCHIVE_ALICE, ARCHIVE_BOB].map((archiveUser) =>
        User.findById(archiveUser._id).lean<{ username?: string } | null>(),
      ),
    );
    expect(importedUsers.map((user) => user?.username)).toEqual([
      ARCHIVE_ADMIN.username,
      ARCHIVE_ALICE.username,
      ARCHIVE_BOB.username,
    ]);

    const importedGroups = await Promise.all(
      [ARCHIVE_GROUP_ENGINEERING, ARCHIVE_GROUP_SALES].map((archiveGroup) =>
        UserGroup.findById(archiveGroup._id).lean<{ name?: string } | null>(),
      ),
    );
    expect(importedGroups.map((group) => group?.name)).toEqual([
      ARCHIVE_GROUP_ENGINEERING.name,
      ARCHIVE_GROUP_SALES.name,
    ]);

    // The shared name now belongs to the incoming group and to nothing else, so the
    // destination's copy really was removed rather than merely re-pointed at.
    const groupsUnderSharedName = await UserGroup.find({
      name: DEST_GROUP.name,
    }).lean<{ _id: unknown }[]>();
    expect(groupsUnderSharedName.map((group) => String(group._id))).toEqual([
      ARCHIVE_GROUP_ENGINEERING._id,
    ]);

    // Exhaustive rather than one account at a time: what the destination holds afterwards
    // is the source's whole population plus the rescued administrator, and nothing else
    // of its own — an account this file never named could not slip through.
    const remainingUsers = await User.find({
      username: new RegExp(`^${FIXTURE_PREFIX}`),
    })
      .select('username')
      .lean<{ username: string }[]>();
    expect(remainingUsers.map((user) => user.username).sort()).toEqual(
      [
        ARCHIVE_ADMIN.username,
        ARCHIVE_ALICE.username,
        ARCHIVE_BOB.username,
        RESCUED_USERNAME,
      ].sort(),
    );
  });

  test('gives every imported user exactly the groups they belonged to at the source', async () => {
    const response = await runMigrationTransfer('g2g-mig-groups.growi.zip');

    expect(response.status).toBe(200);
    expect(response.body.failedCollections).toEqual([]);

    // What "the group-public page is still reachable" reduces to (requirement 2.2): the
    // set of group ids the destination resolves for this user is the set the source had.
    expect(await resolveRelatedGroupIds(ARCHIVE_ALICE._id)).toEqual(
      sourceGroupIdsOf(ARCHIVE_ALICE._id),
    );
    expect(await resolveRelatedGroupIds(ARCHIVE_BOB._id)).toEqual(
      sourceGroupIdsOf(ARCHIVE_BOB._id),
    );

    // Membership is not simply "everyone is in everything": bob has one group and alice
    // has two, so a relation import that lost the pairing could not pass both above.
    expect(sourceGroupIdsOf(ARCHIVE_ALICE._id)).toHaveLength(2);
    expect(sourceGroupIdsOf(ARCHIVE_BOB._id)).toHaveLength(1);

    // The rescued administrator is deliberately in none of them (requirement 4.7): it is
    // an emergency account, not a member of the source's organisation.
    const rescued = await User.findOne({ username: RESCUED_USERNAME });
    expect(rescued).not.toBeNull();
    expect(
      await UserGroupRelation.findAllUserGroupIdsRelatedToUser(rescued),
    ).toEqual([]);
  });

  test('leaves the rescued administrator able to sign in with the password and the access token it already had', async () => {
    const response = await runMigrationTransfer('g2g-mig-rescue.growi.zip');

    expect(response.status).toBe(200);
    expect(response.body.failedCollections).toEqual([]);
    expect(response.body.rescueApplied).toBe(true);
    // The name the operator is told to sign in under (requirement 4.6), taken from the
    // response rather than assumed, so this test signs in as the account the transfer
    // actually reported.
    expect(response.body.rescue.rescued).toEqual([
      expect.objectContaining({
        originalUsername: DEST_ADMIN.username,
        rescuedUsername: RESCUED_USERNAME,
        idReassigned: false,
      }),
    ]);

    // Read back out of the database, exactly as `LocalStrategy` does before calling
    // `isPasswordValid`: an in-memory copy carried over from the Arrange would pass even
    // if nothing of the password had reached the collection (requirements 4.2, 7.3).
    const rescuedAdmin = await User.findOne({
      username: response.body.rescue.rescued[0].rescuedUsername,
    });
    expect(rescuedAdmin).not.toBeNull();
    expect(rescuedAdmin?.isPasswordValid(DEST_ADMIN_PASSWORD)).toBe(true);
    // The credential really is being checked, rather than every password being accepted
    // by an account that ended up with no hash at all.
    expect(rescuedAdmin?.isPasswordValid(`${DEST_ADMIN_PASSWORD}-wrong`)).toBe(
      false,
    );
    // Signing in is only worth anything if the account still has its powers and is in a
    // state `loginRequired` lets through (requirement 4.1).
    expect(rescuedAdmin?.admin).toBe(true);
    expect(rescuedAdmin?.status).toBe(UserStatus.STATUS_ACTIVE);

    // The token was issued before the transfer and its plaintext was never stored, so
    // resolving it now goes through the same hashing and lookup an API caller's request
    // does — which a surviving `tokenHash` alone would not demonstrate (requirement 4.9).
    const resolved = await AccessToken.findUserIdByToken(
      destAdminPlainToken,
      TOKEN_SCOPES,
    );
    expect(resolved).not.toBeNull();
    expect(String(resolved?.user)).toBe(DEST_ADMIN._id);
    // The identifier did not move, so the session established before the transfer still
    // belongs to this account too (requirement 4.3).
    expect(String(rescuedAdmin?._id)).toBe(DEST_ADMIN._id);
  });
});
