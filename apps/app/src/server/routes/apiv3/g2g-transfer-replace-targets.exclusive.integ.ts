/**
 * The conflict gate must not stop a transfer over a collection that is being replaced
 * (requirements 2.3, 6.2).
 *
 * The gate exists because an import that adds to the destination silently drops the
 * documents that violate a unique index, leaving group-granted pages pointing at users
 * that were never created (issue #10151). A collection imported by replacement has none
 * of that: every existing document is deleted before the archive's are written, so there
 * is nothing left to collide with. Refusing such a transfer would block the very case
 * the replacement was chosen for — the destination already has an admin and a group with
 * the same names as the source's.
 *
 * The counterpart matters just as much and is asserted here too: a transfer that replaces
 * nothing must still be stopped, or the gate has quietly been switched off.
 *
 * These tests empty `usergroups`, hence the `.exclusive.` file name.
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

/** The destination already runs a group by this name — the ordinary migration situation. */
const EXISTING_GROUP_NAME = 'g2g-replace-existing-group';

/** Same name, different `_id`: what the gate reports as a conflict. */
const ARCHIVE_GROUP = {
  _id: '0123456789abcdef01490001',
  name: EXISTING_GROUP_NAME,
} as const;

const OPERATOR_USER_ID = '0123456789abcdef01490002';

const GROUPS_JSON = 'usergroups.json';
const ZIP_NAME = 'g2g-replace-transfer.zip';

describe('receive route POST / — a replaced collection cannot conflict', () => {
  let app: express.Application;
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
    archive.append(JSON.stringify([ARCHIVE_GROUP]), { name: GROUPS_JSON });
    await archive.finalize();
    await written;

    return zipPath;
  };

  const postArchive = (zipPath: string, mode: ImportMode): request.Test =>
    request(app)
      .post('/')
      .set(X_GROWI_TRANSFER_KEY_HEADER_NAME, transferKeyValue)
      .field('collections', JSON.stringify(['usergroups']))
      .field('optionsMap', JSON.stringify({ usergroups: { mode } }))
      .field('operatorUserId', OPERATOR_USER_ID)
      .field('uploadConfigs', JSON.stringify({}))
      .attach('transferDataZipFile', zipPath);

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'g2g-replace-targets-'));
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

    UserGroup = mongoose.model<IUserGroup>('UserGroup');

    const receiverService = new G2GTransferReceiverService(crowi);
    crowi.g2gTransferReceiverService = receiverService;
    crowi.g2gTransferPusherService = mock<G2GTransferPusherService>();

    await configManager.loadConfigs();
    addCustomFunctionToResponse(express);

    app = express();
    app.use(setup(crowi));

    const keyString = await receiverService.createTransferKey(
      'http://g2g-replace-source.example.com',
    );
    transferKeyValue = TransferKey.parse(keyString).key;
  }, 120_000);

  beforeEach(async () => {
    await UserGroup.create({ name: EXISTING_GROUP_NAME });
  });

  afterEach(async () => {
    await UserGroup.deleteMany({});
    const leftovers = await fs.readdir(importsDir);
    await Promise.all(
      leftovers.map((fileName) => fs.rm(path.join(importsDir, fileName))),
    );
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('imports the archive’s group over a same-named existing one when the collection is replaced', async () => {
    const zipPath = await writeArchiveZip();

    const response = await postArchive(zipPath, ImportMode.flushAndInsert);

    expect(response.status).toBe(200);

    // The destination's group is gone and the source's is in its place, under the
    // source's own `_id` — which is what keeps the transferred pages and relations
    // pointing at the right group.
    const groups = await UserGroup.find({ name: EXISTING_GROUP_NAME });
    expect(groups).toHaveLength(1);
    expect(groups[0]._id.toString()).toBe(ARCHIVE_GROUP._id);
  });

  test('still aborts on the same collision when the collection is only added to', async () => {
    const zipPath = await writeArchiveZip();
    const existingBefore = await UserGroup.findOne({
      name: EXISTING_GROUP_NAME,
    });

    const response = await postArchive(zipPath, ImportMode.insert);

    expect(response.status).toBe(409);
    expect(response.body.errors[0].code).toBe(G2G_DATA_CONFLICT_ERROR_CODE);
    // Nothing was written: the destination's own group is untouched and the archive's
    // never arrived.
    expect(await UserGroup.findById(ARCHIVE_GROUP._id)).toBeNull();
    expect(
      (await UserGroup.findOne({ name: EXISTING_GROUP_NAME }))?._id.toString(),
    ).toBe(existingBefore?._id.toString());
  });
});
