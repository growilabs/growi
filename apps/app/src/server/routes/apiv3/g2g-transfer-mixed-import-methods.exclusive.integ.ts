/**
 * Route-level integration test for the ordinary merge-preset shape passing the receive
 * route's import-method coherence gate (task 9.1, requirements 1.3, 6.1).
 *
 * `configs` is always replaced (`getImportSettingMap` throws for any other mode) while
 * every other collection in the merge preset is, by default, appended to — "configs
 * replaced, users appended" is not an edge case, it is what an ordinary legacy-mode
 * transfer sends. `isCoherentOptionsMap` is written to exempt `configs` from the
 * coherence judgement for exactly this reason (`COLLECTIONS_EXCLUDED_FROM_COHERENCE`
 * in `models/admin/g2g-transfer-preset.ts`), and this test proves the receive route's
 * wiring honors that: the request must not be refused as "mixed", and — the only proof
 * that is not "no error was thrown" — the transfer must actually complete, with the
 * archive's user really landing in the destination's database.
 *
 * Importing `configs` empties that whole collection (`flushAndInsert` is forced), which
 * would destroy any other integration test file's fixtures sharing the same per-worker
 * database — hence `.exclusive.` (see vitest.workspace.mts and the sibling
 * `import-maintenance-mode.exclusive.integ.ts`, which documents the same hazard).
 *
 * Requires a real MongoDB (wired by vitest.workspace.mts integ setup).
 */

import { EventEmitter } from 'node:events';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IUser } from '@growi/core';
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

const ARCHIVE_USER = {
  _id: '0123456789abcdef01480001',
  username: 'g2g-legacy-shape-user',
  email: 'g2g-legacy-shape-user@example.com',
} as const;

const OPERATOR_USER_ID = '0123456789abcdef01480002';

const CONFIGS_JSON = 'configs.json';
const USERS_JSON = 'users.json';
const ZIP_NAME = 'g2g-legacy-shape-transfer.zip';

describe('receive route POST / — the ordinary merge-preset shape (configs replaced, users appended)', () => {
  let app: express.Application;
  let User: Model<IUser>;
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
    // Empty on purpose: what this test cares about is that `configs` is present as a
    // *targeted collection* (so getImportSettingMap sees it and forces flushAndInsert),
    // not what settings it carries.
    archive.append(JSON.stringify([]), { name: CONFIGS_JSON });
    archive.append(JSON.stringify([ARCHIVE_USER]), { name: USERS_JSON });
    await archive.finalize();
    await written;

    return zipPath;
  };

  const postArchive = (zipPath: string): request.Test =>
    request(app)
      .post('/')
      .set(X_GROWI_TRANSFER_KEY_HEADER_NAME, transferKeyValue)
      .field('collections', JSON.stringify(['configs', 'users']))
      .field(
        'optionsMap',
        JSON.stringify({
          configs: { mode: ImportMode.flushAndInsert },
          users: { mode: ImportMode.insert },
        }),
      )
      .field('operatorUserId', OPERATOR_USER_ID)
      .field('uploadConfigs', JSON.stringify({}))
      .attach('transferDataZipFile', zipPath);

  /**
   * By `username`/`email` as well as by `_id`: a leftover document from an earlier
   * interrupted run can carry this fixture's unique fields under a different `_id`,
   * and deleting by `_id` alone would leave it behind to collide with the next run's
   * import (`insert` fails on a duplicate `username`/`email`) — the same shape
   * `g2g-transfer.integ.ts` uses.
   */
  const removeFixtures = async (): Promise<void> => {
    await User.deleteMany({
      $or: [
        { username: ARCHIVE_USER.username },
        { email: ARCHIVE_USER.email },
        { _id: ARCHIVE_USER._id },
      ],
    });
    const leftovers = await fs.readdir(importsDir);
    await Promise.all(
      // `force`: the receive route's own handler deletes the uploaded archive
      // (`deleteReceivedArchive` in g2g-transfer.ts) from its `finally` block, which
      // resolves the client's response before that block runs — so this sweep can
      // race the route's own cleanup of the same file and hit ENOENT on a file that
      // is simply already gone, not a real failure to clean up.
      leftovers.map((fileName) =>
        fs.rm(path.join(importsDir, fileName), { force: true }),
      ),
    );
  };

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'g2g-legacy-shape-'));
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

    const receiverService = new G2GTransferReceiverService(crowi);
    crowi.g2gTransferReceiverService = receiverService;
    crowi.g2gTransferPusherService = mock<G2GTransferPusherService>();

    await configManager.loadConfigs();
    addCustomFunctionToResponse(express);

    app = express();
    app.use(setup(crowi));

    const keyString = await receiverService.createTransferKey(
      'http://g2g-legacy-shape-source.example.com',
    );
    transferKeyValue = TransferKey.parse(keyString).key;

    // Run once before the first test too, not only between tests: a document left
    // behind by an earlier, separately-run process (this DB is a persistent external
    // MongoDB, not recreated per run — see test/setup/mongo/index.ts) would otherwise
    // survive into this file's very first Arrange and trip the conflict-detection gate
    // or a duplicate-key error before the test under test even runs.
    await removeFixtures();
  }, 120_000);

  afterEach(async () => {
    await removeFixtures();
    // The import forces maintenance mode on once `configs` is imported (task 4.1); put
    // this GROWI back the way the next test in this exclusive-database project expects
    // to find it, the same way import-maintenance-mode.exclusive.integ.ts does.
    await configManager.updateConfig('app:isMaintenanceMode', false);
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('is not refused as a mixed assignment, and the transfer actually completes', async () => {
    const zipPath = await writeArchiveZip();

    const response = await postArchive(zipPath);

    expect(response.status).toBe(200);
    expect(response.body.errors?.[0]?.code).not.toBe(
      G2G_MIXED_IMPORT_MODES_ERROR_CODE,
    );

    // Proof the transfer really ran end to end, not just that the gate stayed quiet:
    // the archive's user is now in the destination.
    const importedUser = await User.findById(ARCHIVE_USER._id);
    expect(importedUser?.username).toBe(ARCHIVE_USER.username);
  });
});
