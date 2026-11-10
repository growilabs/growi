/**
 * Route-level test for what the receive route records about a migration transfer it
 * takes in (requirements 2.3, 2.4, 2.7, 2.8). The import itself and the metric recorder
 * are mocks: the observable contract here is which outcome the route hands to the
 * recorder, and that the HTTP answer the source reads is unchanged.
 *
 * Requires a real MongoDB (wired by vitest.workspace.mts integ setup) for the conflict
 * detection the route runs before importing.
 */

import { EventEmitter } from 'node:events';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import archiver from 'archiver';
import express from 'express';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import { ImportMode } from '~/models/admin/import-mode';
import type Crowi from '~/server/crowi';
import {
  setupIndependentModels,
  setupModelsDependentOnCrowi,
} from '~/server/crowi/setup-models';
import type UserEvent from '~/server/events/user';
import {
  G2G_MONGO_COLLECTION_IMPORT_FAILURE_ERROR_CODE,
  G2G_PARSE_FAILED_ERROR_CODE,
} from '~/server/models/vo/g2g-transfer-error';
import type AppService from '~/server/service/app';
import { configManager } from '~/server/service/config-manager';
import instanciateExportService from '~/server/service/export';
import {
  type G2GTransferPusherService,
  G2GTransferReceiverService,
  type ImportCollectionsResult,
  X_GROWI_TRANSFER_KEY_HEADER_NAME,
} from '~/server/service/g2g-transfer';
import { GrowiBridgeService } from '~/server/service/growi-bridge';
import { initializeImportService } from '~/server/service/import';
import { getGrowiVersion } from '~/utils/growi-version';
import { TransferKey } from '~/utils/vo/transfer-key';

import { setup } from './g2g-transfer';
import addCustomFunctionToResponse from './response';

const { recordG2GTransfer } = vi.hoisted(() => ({
  recordG2GTransfer: vi.fn(),
}));

vi.mock('~/features/opentelemetry/server', () => ({ recordG2GTransfer }));

/** Collides with nothing in the destination, so conflict detection lets it through. */
const ARCHIVE_USER = {
  _id: '0123456789abcdef01490001',
  username: 'g2g-destination-metrics-user',
  email: 'g2g-destination-metrics-user@example.com',
} as const;

const OPERATOR_USER_ID = '0123456789abcdef01490002';

const COMPLETE_IMPORT: ImportCollectionsResult = {
  failedCollections: [],
  importAborted: false,
  rescue: null,
  rescueApplied: false,
  postProcessFailures: [],
  maintenanceModeReleased: true,
};

describe('receive route POST / records the destination-side outcome', () => {
  let app: express.Application;
  let receiverService: G2GTransferReceiverService;
  let tmpDir: string;
  let zipPath: string;
  let transferKeyValue: string;

  const writeArchiveZip = async (): Promise<string> => {
    const target = path.join(tmpDir, 'g2g-destination-metrics.zip');
    const archive = archiver('zip');
    const output = createWriteStream(target);
    const written = new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);
    });

    archive.pipe(output);
    archive.append(JSON.stringify({ version: getGrowiVersion() }), {
      name: 'meta.json',
    });
    archive.append(JSON.stringify([ARCHIVE_USER]), { name: 'users.json' });
    await archive.finalize();
    await written;

    return target;
  };

  const postArchive = (
    collectionsField = JSON.stringify(['users']),
  ): request.Test =>
    request(app)
      .post('/')
      .set(X_GROWI_TRANSFER_KEY_HEADER_NAME, transferKeyValue)
      .field('collections', collectionsField)
      .field(
        'optionsMap',
        JSON.stringify({ users: { mode: ImportMode.insert } }),
      )
      .field('operatorUserId', OPERATOR_USER_ID)
      .field('uploadConfigs', JSON.stringify({}))
      .attach('transferDataZipFile', zipPath);

  // The route records in its `finally`, after the response has gone out and the
  // received archive has been deleted, so the answer can arrive first.
  const recorded = () =>
    vi.waitFor(() => expect(recordG2GTransfer).toHaveBeenCalled());

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'g2g-destination-metrics-'),
    );
    await fs.mkdir(path.join(tmpDir, 'imports'), { recursive: true });

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

    receiverService = new G2GTransferReceiverService(crowi);
    crowi.g2gTransferReceiverService = receiverService;
    crowi.g2gTransferPusherService = mock<G2GTransferPusherService>();

    await configManager.loadConfigs();
    addCustomFunctionToResponse(express);

    app = express();
    app.use(setup(crowi));

    const keyString = await receiverService.createTransferKey(
      'http://g2g-destination-metrics.example.com',
    );
    transferKeyValue = TransferKey.parse(keyString).key;

    // The route deletes multer's uploaded copy, never this source.
    zipPath = await writeArchiveZip();
  }, 120_000);

  beforeEach(() => {
    recordG2GTransfer.mockClear();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('records one success when the import completed, and answers as before', async () => {
    vi.spyOn(receiverService, 'importCollections').mockResolvedValue(
      COMPLETE_IMPORT,
    );

    const response = await postArchive();

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: 'Successfully started to receive transfer data.',
      failedCollections: [],
      importAborted: false,
      rescue: null,
      rescueApplied: false,
      postProcessFailures: [],
      maintenanceModeReleased: true,
    });
    await recorded();
    expect(recordG2GTransfer.mock.calls).toEqual([['destination', 'success']]);
  });

  test('records one failure when a collection failed to import, though the answer is still a success', async () => {
    vi.spyOn(receiverService, 'importCollections').mockResolvedValue({
      ...COMPLETE_IMPORT,
      failedCollections: ['users'],
    });

    const response = await postArchive();

    expect(response.status).toBe(200);
    expect(response.body.failedCollections).toEqual(['users']);
    await recorded();
    expect(recordG2GTransfer.mock.calls).toEqual([['destination', 'failure']]);
  });

  test('records one failure when the import aborted, though the answer is still a success', async () => {
    vi.spyOn(receiverService, 'importCollections').mockResolvedValue({
      ...COMPLETE_IMPORT,
      importAborted: true,
    });

    const response = await postArchive();

    expect(response.status).toBe(200);
    expect(response.body.importAborted).toBe(true);
    await recorded();
    expect(recordG2GTransfer.mock.calls).toEqual([['destination', 'failure']]);
  });

  test('records one failure when the request body cannot be parsed, and answers with the same error', async () => {
    const importCollections = vi.spyOn(receiverService, 'importCollections');

    const response = await postArchive('not json');

    expect(response.status).toBe(500);
    expect(response.body.errors[0].code).toBe(G2G_PARSE_FAILED_ERROR_CODE);
    expect(importCollections).not.toHaveBeenCalled();
    await recorded();
    expect(recordG2GTransfer.mock.calls).toEqual([['destination', 'failure']]);
  });

  test('records one failure when the import throws, and answers with the same error', async () => {
    vi.spyOn(receiverService, 'importCollections').mockRejectedValue(
      new Error('import failed'),
    );

    const response = await postArchive();

    expect(response.status).toBe(500);
    expect(response.body.errors[0].code).toBe(
      G2G_MONGO_COLLECTION_IMPORT_FAILURE_ERROR_CODE,
    );
    await recorded();
    expect(recordG2GTransfer.mock.calls).toEqual([['destination', 'failure']]);
  });

  test('records nothing when the transfer key is rejected', async () => {
    const response = await request(app)
      .post('/')
      .set(X_GROWI_TRANSFER_KEY_HEADER_NAME, 'not-a-valid-key')
      .attach('transferDataZipFile', zipPath);

    expect(response.status).not.toBe(200);
    expect(recordG2GTransfer).not.toHaveBeenCalled();
  });
});
