/**
 * Route-level integration test for the receive route's unique-conflict gate.
 *
 * Approach: the REAL router (`setup(crowi)`) is mounted on express and driven over
 * HTTP with a REAL zip archive, so the request passes through the genuine transfer-key
 * check, multer upload, `importService.unzip`, `growiBridgeService.parseZipFile`,
 * meta validation and `getImportSettingMap` before reaching the gate. Detection runs
 * against a real MongoDB holding real seeded documents, and the no-conflict branch
 * performs the real import — nothing on the decision path is stubbed.
 *
 * That fidelity is the point: whether the import started is asserted from the
 * database (documents present / absent), not from a spy on `importCollections`.
 * Issue #10151 is precisely a partially-applied import, so the archive used in the
 * conflict case carries one colliding and one clean document: before the gate existed
 * the clean one was inserted while the colliding one was silently dropped.
 *
 * Requires a real MongoDB (wired by vitest.workspace.mts integ setup).
 */

import { EventEmitter } from 'node:events';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IUser, IUserGroup } from '@growi/core';
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
import { G2G_DATA_CONFLICT_ERROR_CODE } from '~/server/models/vo/g2g-transfer-error';
import type AppService from '~/server/service/app';
import { configManager } from '~/server/service/config-manager';
import instanciateExportService from '~/server/service/export';
import {
  G2GTransferPusherService,
  G2GTransferReceiverService,
  X_GROWI_TRANSFER_KEY_HEADER_NAME,
} from '~/server/service/g2g-transfer';
import { GrowiBridgeService } from '~/server/service/growi-bridge';
import { initializeImportService } from '~/server/service/import';
import { getGrowiVersion } from '~/utils/growi-version';
import { TransferKey } from '~/utils/vo/transfer-key';

import { setup } from './g2g-transfer';
import addCustomFunctionToResponse from './response';

// Fixture values carry a distinctive prefix so they cannot collide with documents that
// other integration test files may have left behind in the per-worker database.
const EXISTING_USER = {
  name: 'g2g-route existing admin',
  username: 'g2g-route-existing-admin',
  email: 'g2g-route-existing-admin@example.com',
} as const;

// Collides with EXISTING_USER on `email` while carrying its own `_id`.
const COLLIDING_USER = {
  _id: '0123456789abcdef01410001',
  username: 'g2g-route-colliding-user',
  email: EXISTING_USER.email,
} as const;

// Collides with nothing: this is the document a silent partial import would insert.
const CLEAN_USER = {
  _id: '0123456789abcdef01410002',
  username: 'g2g-route-clean-user',
  email: 'g2g-route-clean-user@example.com',
} as const;

const EXISTING_GROUP_NAME = 'g2g-route-existing-group';

const COLLIDING_GROUP = {
  _id: '0123456789abcdef01410003',
  name: EXISTING_GROUP_NAME,
} as const;

const CLEAN_GROUP = {
  _id: '0123456789abcdef01410004',
  name: 'g2g-route-clean-group',
} as const;

const OPERATOR_USER_ID = '0123456789abcdef01410005';

// Requirement 2.1 names usergrouprelations and pages alongside users and usergroups, so the
// colliding archive carries one of each. Neither collides with anything: an import that
// started anyway would insert them, which is what makes the "destination unchanged" check
// below say something about these two collections rather than comparing empty sets.
const CLEAN_RELATION = {
  _id: '0123456789abcdef01410006',
  relatedGroup: CLEAN_GROUP._id,
  relatedUser: CLEAN_USER._id,
} as const;

const CLEAN_PAGE = {
  _id: '0123456789abcdef01410007',
  path: '/g2g-route-clean-page',
  grantedGroups: [{ type: 'UserGroup', item: CLEAN_GROUP._id }],
} as const;

// What the source UI sends for pages; `isImportOptionForPages` keys off the first flag.
const PAGE_IMPORT_OPTION_FLAGS = {
  isOverwriteAuthorWithCurrentUser: false,
  makePublicForGrant2: false,
  makePublicForGrant4: false,
  makePublicForGrant5: false,
  initPageMetadatas: false,
} as const;

const USERS_JSON = 'users.json';
const GROUPS_JSON = 'usergroups.json';
const RELATIONS_JSON = 'usergrouprelations.json';
const PAGES_JSON = 'pages.json';
const ZIP_NAME = 'g2g-route-transfer.zip';

const SNAPSHOT_COLLECTIONS = [
  'users',
  'usergroups',
  'usergrouprelations',
  'pages',
] as const;

describe('receive route POST / — unique conflict gate', () => {
  let app: express.Application;
  let User: Model<IUser>;
  let UserGroup: Model<IUserGroup>;
  let tmpDir: string;
  let importsDir: string;
  let transferKeyValue: string;

  /** Builds a real zip the way the pusher sends one: meta.json plus one JSON per collection. */
  const writeArchiveZip = async (
    entries: Readonly<Record<string, string>>,
  ): Promise<string> => {
    const zipPath = path.join(tmpDir, ZIP_NAME);
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
    for (const [name, content] of Object.entries(entries)) {
      archive.append(content, { name });
    }
    await archive.finalize();
    await written;

    return zipPath;
  };

  const postArchive = (
    zipPath: string,
    collections: readonly string[],
  ): request.Test =>
    request(app)
      .post('/')
      .set(X_GROWI_TRANSFER_KEY_HEADER_NAME, transferKeyValue)
      .field('collections', JSON.stringify(collections))
      .field(
        'optionsMap',
        JSON.stringify(
          Object.fromEntries(
            collections.map((collectionName) => [
              collectionName,
              // pages is the one collection with its own option shape: getImportSettingMap
              // rejects `insert` for it, and generateOverwriteParams rejects an option that
              // carries none of the page-specific flags.
              collectionName === 'pages'
                ? { mode: ImportMode.upsert, ...PAGE_IMPORT_OPTION_FLAGS }
                : { mode: ImportMode.insert },
            ]),
          ),
        ),
      )
      .field('operatorUserId', OPERATOR_USER_ID)
      .field('uploadConfigs', JSON.stringify({}))
      .attach('transferDataZipFile', zipPath);

  const seedDestination = async (): Promise<void> => {
    await User.create({ ...EXISTING_USER });
    await UserGroup.create({ name: EXISTING_GROUP_NAME });
  };

  // Whole-collection snapshots (raw driver reads, so timestamps and __v are included).
  const snapshotDestination = async (): Promise<unknown> => {
    const snapshots = await Promise.all(
      SNAPSHOT_COLLECTIONS.map((collectionName) =>
        mongoose.connection
          .collection(collectionName)
          .find({})
          .sort({ _id: 1 })
          .toArray(),
      ),
    );
    return Object.fromEntries(
      SNAPSHOT_COLLECTIONS.map((collectionName, i) => [
        collectionName,
        snapshots[i],
      ]),
    );
  };

  const removeFixtures = async (): Promise<void> => {
    await User.deleteMany({
      $or: [
        {
          username: {
            $in: [
              EXISTING_USER.username,
              COLLIDING_USER.username,
              CLEAN_USER.username,
            ],
          },
        },
        { _id: { $in: [COLLIDING_USER._id, CLEAN_USER._id] } },
      ],
    });
    await UserGroup.deleteMany({
      $or: [
        { name: { $in: [EXISTING_GROUP_NAME, CLEAN_GROUP.name] } },
        { _id: { $in: [COLLIDING_GROUP._id, CLEAN_GROUP._id] } },
      ],
    });
    // Every test declares the archive it uploads, so leftovers from a previous test
    // (the unzipped JSONs and the uploaded zip) must not satisfy the next one.
    const leftovers = await fs.readdir(importsDir);
    await Promise.all(
      leftovers.map((fileName) => fs.rm(path.join(importsDir, fileName))),
    );
  };

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'g2g-route-conflicts-'));
    importsDir = path.join(tmpDir, 'imports');
    await fs.mkdir(importsDir, { recursive: true });

    // PageEvent / AdminEvent are typed 'any' in the Crowi interface, so plain
    // instances are accepted without a cast.
    const crowi = mock<Crowi>({
      tmpDir,
      events: {
        page: mock<EventEmitter>(),
        user: mock<UserEvent>(),
        admin: new EventEmitter(),
      },
      appService: mock<AppService>(),
    });
    // ImportService reads growiBridgeService in its constructor, so wire it up first.
    crowi.growiBridgeService = new GrowiBridgeService(crowi);
    initializeImportService(crowi);
    instanciateExportService(crowi);

    await setupModelsDependentOnCrowi(crowi);
    await setupIndependentModels();

    User = mongoose.model<IUser>('User');
    UserGroup = mongoose.model<IUserGroup>('UserGroup');

    const receiverService = new G2GTransferReceiverService(crowi);
    crowi.g2gTransferReceiverService = receiverService;
    crowi.g2gTransferPusherService = new G2GTransferPusherService(crowi);

    // The route reads 'app:installed' while being built.
    await configManager.loadConfigs();

    // Patches express.response.apiv3/apiv3Err with the real implementation (the same
    // call production makes in apiv3/index.js), so the asserted body shape is the one
    // the pusher will actually receive.
    addCustomFunctionToResponse(express);

    app = express();
    app.use(setup(crowi));

    // A real TransferKey document: the receive route rejects anything else with 403.
    const keyString = await receiverService.createTransferKey(
      'http://g2g-route-source.example.com',
    );
    transferKeyValue = TransferKey.parse(keyString).key;

    await removeFixtures();
  }, 120_000);

  afterEach(async () => {
    await removeFixtures();
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('aborts with 409 and imports nothing when the archive collides with existing data', async () => {
    // Requirements 2.1, 2.2, 2.3 — the transfer must not be reported as successful, and
    // not one document may be written (not even the documents that do not collide).
    await seedDestination();

    const zipPath = await writeArchiveZip({
      [USERS_JSON]: JSON.stringify([COLLIDING_USER, CLEAN_USER]),
      [GROUPS_JSON]: JSON.stringify([COLLIDING_GROUP]),
      [RELATIONS_JSON]: JSON.stringify([CLEAN_RELATION]),
      [PAGES_JSON]: JSON.stringify([CLEAN_PAGE]),
    });

    const before = await snapshotDestination();

    const response = await postArchive(zipPath, [
      'users',
      'usergroups',
      'usergrouprelations',
      'pages',
    ]);

    expect(response.status).toBe(409);
    // The exact body shape the pusher reads to tell a conflict from any other failure.
    expect(response.body).toEqual({
      errors: [
        {
          message: expect.stringContaining('users: 1 conflict'),
          code: G2G_DATA_CONFLICT_ERROR_CODE,
        },
      ],
    });
    const { message } = response.body.errors[0];
    expect(message).toContain('usergroups: 1 conflict');
    expect(message).toContain('email');
    expect(message).toContain(EXISTING_USER.email);
    expect(message).toContain(EXISTING_GROUP_NAME);

    // The import never started: the colliding documents are absent (as they would be
    // even without the gate) AND so is the clean one (which the gate is what prevents).
    expect(await User.findById(CLEAN_USER._id)).toBeNull();
    expect(await User.findById(COLLIDING_USER._id)).toBeNull();
    expect(await UserGroup.findById(COLLIDING_GROUP._id)).toBeNull();
    // Requirement 2.1 covers usergrouprelations and pages too, and those two are what
    // issue #10151 leaves pointing at a user that was never created.
    for (const [collectionName, id] of [
      ['usergrouprelations', CLEAN_RELATION._id],
      ['pages', CLEAN_PAGE._id],
    ] as const) {
      expect(
        await mongoose.connection
          .collection(collectionName)
          .findOne({ _id: new mongoose.Types.ObjectId(id) }),
      ).toBeNull();
    }
    expect(await snapshotDestination()).toEqual(before);
  });

  test('imports as before when the archive does not collide with existing data', async () => {
    // Requirement 4.3 — the gate must not change the successful path. The seeded
    // documents stay in place so detection really runs against existing data.
    await seedDestination();

    const zipPath = await writeArchiveZip({
      [USERS_JSON]: JSON.stringify([CLEAN_USER]),
      [GROUPS_JSON]: JSON.stringify([CLEAN_GROUP]),
    });

    const response = await postArchive(zipPath, ['users', 'usergroups']);

    expect(response.status).toBe(200);
    // Matched whole, not field by field: the body is what crosses to the source GROWI and
    // on to the source operator's browser, so a field appearing here that nobody decided
    // to send — the rescue's password hashes above all — has to fail this test.
    expect(response.body).toEqual({
      message: 'Successfully started to receive transfer data.',
      // The source reads this to tell a finished transfer from a half-finished one.
      failedCollections: [],
      // The import ran to the end, so it could name what failed — nothing did.
      importAborted: false,
      // This transfer appends rather than replaces, so the receiving side's replace
      // procedure has nothing to do: nobody was rescued, no clean-up ran, and the
      // destination's maintenance mode was never touched.
      rescue: null,
      rescueApplied: false,
      postProcessFailures: [],
      maintenanceModeReleased: false,
    });

    // The import really ran: both archive documents are now in the destination.
    const importedUser = await User.findById(CLEAN_USER._id);
    expect(importedUser?.username).toBe(CLEAN_USER.username);
    const importedGroup = await UserGroup.findById(CLEAN_GROUP._id);
    expect(importedGroup?.name).toBe(CLEAN_GROUP.name);
    // The existing documents are untouched.
    expect(
      await User.findOne({ username: EXISTING_USER.username }),
    ).not.toBeNull();
  });

  test('fails with a distinct 5xx and imports nothing when the detection itself cannot complete', async () => {
    // Error Handling / Error Strategy — a detection that could not finish says nothing
    // about whether the archive collides, so falling through to the import is what
    // would reproduce issue #10151. A truncated users.json (the array is never closed)
    // is the realistic trigger: streaming it yields documents without any error.
    await seedDestination();

    const truncatedUsersJson = JSON.stringify([CLEAN_USER]).slice(0, -1);
    const zipPath = await writeArchiveZip({
      [USERS_JSON]: truncatedUsersJson,
      [GROUPS_JSON]: JSON.stringify([CLEAN_GROUP]),
    });

    const before = await snapshotDestination();

    const response = await postArchive(zipPath, ['users', 'usergroups']);

    expect(response.status).toBe(500);
    expect(response.body.errors[0].code).toBe('conflict_detection_failed');
    expect(response.body.errors[0].code).not.toBe(G2G_DATA_CONFLICT_ERROR_CODE);

    expect(await User.findById(CLEAN_USER._id)).toBeNull();
    expect(await UserGroup.findById(CLEAN_GROUP._id)).toBeNull();
    expect(await snapshotDestination()).toEqual(before);
  });
});
