/**
 * Route-level integration test for the receive route's import-method coherence gate
 * (requirements 1.3, 6.1).
 *
 * `isCoherentOptionsMap` (`models/admin/g2g-transfer-preset.ts`) judges whether a
 * request's collections/optionsMap pairing either replaces everything or replaces
 * nothing; the receive route's only job is to call it and refuse before anything is
 * unzipped or written when it says no (task 9.1). This file proves the wiring, not the
 * judgement itself (that is `g2g-transfer-preset.spec.ts`'s job): a request that mixes
 * a replaced collection with an appended one must be refused, and — the only way to
 * show "refused" rather than "an error was thrown somewhere" — the destination must be
 * provably untouched by it, checked with a real before/after snapshot the way the
 * unique-conflict gate's own route test (`g2g-transfer.integ.ts`) does.
 *
 * `configs` and `pages` are deliberately left out of this file: their forced-mode
 * exemption from the coherence judgement is exercised by the companion exclusive file
 * (`g2g-transfer-mixed-import-methods.exclusive.integ.ts`), because a real `configs`
 * import empties that whole collection and needs the worker-exclusive database.
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
import { G2G_MIXED_IMPORT_MODES_ERROR_CODE } from '~/server/models/vo/g2g-transfer-error';
import type AppService from '~/server/service/app';
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

const EXISTING_USER = {
  _id: '0123456789abcdef01470001',
  username: 'g2g-mixed-existing-user',
  email: 'g2g-mixed-existing-user@example.com',
} as const;

const EXISTING_GROUP = {
  _id: '0123456789abcdef01470002',
  name: 'g2g-mixed-existing-group',
} as const;

/** What the archive carries; neither collides with anything already in the database. */
const ARCHIVE_USER = {
  _id: '0123456789abcdef01470003',
  username: 'g2g-mixed-archive-user',
  email: 'g2g-mixed-archive-user@example.com',
} as const;

const ARCHIVE_GROUP = {
  _id: '0123456789abcdef01470004',
  name: 'g2g-mixed-archive-group',
} as const;

const OPERATOR_USER_ID = '0123456789abcdef01470005';

const USERS_JSON = 'users.json';
const GROUPS_JSON = 'usergroups.json';
const ZIP_NAME = 'g2g-mixed-transfer.zip';

const SNAPSHOT_COLLECTIONS = ['users', 'usergroups'] as const;

describe('receive route POST / — the import-method coherence gate', () => {
  let app: express.Application;
  let User: Model<IUser>;
  let UserGroup: Model<IUserGroup>;
  let tmpDir: string;
  let importsDir: string;
  let transferKeyValue: string;

  const writeArchiveZip = async (): Promise<string> => {
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
    archive.append(JSON.stringify([ARCHIVE_USER]), { name: USERS_JSON });
    archive.append(JSON.stringify([ARCHIVE_GROUP]), { name: GROUPS_JSON });
    await archive.finalize();
    await written;

    return zipPath;
  };

  const postArchive = (
    zipPath: string,
    optionsMap: Record<string, { mode: ImportMode }>,
  ): request.Test =>
    request(app)
      .post('/')
      .set(X_GROWI_TRANSFER_KEY_HEADER_NAME, transferKeyValue)
      .field('collections', JSON.stringify(['users', 'usergroups']))
      .field('optionsMap', JSON.stringify(optionsMap))
      .field('operatorUserId', OPERATOR_USER_ID)
      .field('uploadConfigs', JSON.stringify({}))
      .attach('transferDataZipFile', zipPath);

  // Whole-collection snapshots (raw driver reads), the same style
  // `g2g-transfer.integ.ts` uses to prove nothing was written.
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

  const seedDestination = async (): Promise<void> => {
    await User.create({ ...EXISTING_USER });
    await UserGroup.create({ ...EXISTING_GROUP });
  };

  const removeFixtures = async (): Promise<void> => {
    // By `username`/`email`/`name` as well as by `_id`: a leftover document from an
    // earlier interrupted run can carry this fixture's unique fields under a different
    // `_id` (the previous run's own `ObjectId`, not one of the literals below), and
    // deleting by `_id` alone would leave it behind to collide with the next run's
    // `User.create` / import — the same shape `g2g-transfer.integ.ts` uses.
    await User.deleteMany({
      $or: [
        {
          username: { $in: [EXISTING_USER.username, ARCHIVE_USER.username] },
        },
        { email: { $in: [EXISTING_USER.email, ARCHIVE_USER.email] } },
        { _id: { $in: [EXISTING_USER._id, ARCHIVE_USER._id] } },
      ],
    });
    await UserGroup.deleteMany({
      $or: [
        { name: { $in: [EXISTING_GROUP.name, ARCHIVE_GROUP.name] } },
        { _id: { $in: [EXISTING_GROUP._id, ARCHIVE_GROUP._id] } },
      ],
    });
    const leftovers = await fs.readdir(importsDir);
    await Promise.all(
      leftovers.map((fileName) => fs.rm(path.join(importsDir, fileName))),
    );
  };

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'g2g-mixed-'));
    importsDir = path.join(tmpDir, 'imports');
    await fs.mkdir(importsDir, { recursive: true });

    const crowi = mock<Crowi>({
      tmpDir,
      events: {
        page: mock<EventEmitter>(),
        user: mock<UserEvent>(),
        admin: new EventEmitter(),
      },
      appService: mock<AppService>(),
    });
    crowi.growiBridgeService = new GrowiBridgeService(crowi);
    initializeImportService(crowi);
    instanciateExportService(crowi);

    await setupModelsDependentOnCrowi(crowi);
    await setupIndependentModels();

    User = mongoose.model<IUser>('User');
    UserGroup = mongoose.model<IUserGroup>('UserGroup');

    const receiverService = new G2GTransferReceiverService(crowi);
    crowi.g2gTransferReceiverService = receiverService;
    crowi.g2gTransferPusherService = mock<G2GTransferPusherService>();

    await configManager.loadConfigs();
    addCustomFunctionToResponse(express);

    app = express();
    app.use(setup(crowi));

    const keyString = await receiverService.createTransferKey(
      'http://g2g-mixed-source.example.com',
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

  test('refuses a request that replaces one collection and appends to another, and leaves the destination untouched', async () => {
    await seedDestination();
    const zipPath = await writeArchiveZip();

    const before = await snapshotDestination();

    const response = await postArchive(zipPath, {
      users: { mode: ImportMode.flushAndInsert },
      usergroups: { mode: ImportMode.insert },
    });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].code).toBe(
      G2G_MIXED_IMPORT_MODES_ERROR_CODE,
    );

    // Neither the collection that would have been emptied nor the one that would have
    // been appended to changed: not the pre-existing document (proves nothing was
    // deleted), and not the archive's own (proves nothing was written).
    expect(await snapshotDestination()).toEqual(before);
    expect(await User.findById(ARCHIVE_USER._id)).toBeNull();
    expect(await UserGroup.findById(ARCHIVE_GROUP._id)).toBeNull();
    expect(await User.findById(EXISTING_USER._id)).not.toBeNull();
    expect(await UserGroup.findById(EXISTING_GROUP._id)).not.toBeNull();
  });
});
