/**
 * A second import must not start while one is running (requirements 2.7, 2.1).
 *
 * Two imports share one directory of extracted JSON files and one database, so the second
 * one overwrites the files the first is about to read and empties collections underneath
 * it. The window is wider than the import itself: the receive route unzips the archive,
 * re-reads it and queries the destination for conflicts first, and on a large transfer
 * that takes minutes.
 *
 * The claim is therefore taken in a middleware placed before multer, and released on the
 * response's `close`. Both halves are load-bearing and are tested here: taken later, the
 * upload itself is unprotected; released anywhere else, a rejected or abandoned upload
 * would leave the claim held and refuse every import from then on — and the likeliest way
 * to reach that state is a connection dropped during a large transfer, which is precisely
 * when the operator retries.
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
import { G2G_IMPORT_IN_PROGRESS_ERROR_CODE } from '~/server/models/vo/g2g-transfer-error';
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

const FIRST_USER = {
  _id: '0123456789abcdef01460001',
  username: 'g2g-concurrency-first',
  email: 'g2g-concurrency-first@example.com',
} as const;

const SECOND_USER = {
  _id: '0123456789abcdef01460002',
  username: 'g2g-concurrency-second',
  email: 'g2g-concurrency-second@example.com',
} as const;

const OPERATOR_USER_ID = '0123456789abcdef01460003';

const USERS_JSON = 'users.json';

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe('receive route POST / — refusing a concurrent import', () => {
  let app: express.Application;
  let User: Model<IUser>;
  let receiverService: G2GTransferReceiverService;
  let tmpDir: string;
  let importsDir: string;
  let transferKeyValue: string;

  const writeArchiveZip = async (
    name: string,
    users: readonly unknown[],
  ): Promise<string> => {
    const zipPath = path.join(tmpDir, name);
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
    archive.append(JSON.stringify(users), { name: USERS_JSON });
    await archive.finalize();
    await written;

    return zipPath;
  };

  const postArchive = (zipPath: string): request.Test =>
    request(app)
      .post('/')
      .set(X_GROWI_TRANSFER_KEY_HEADER_NAME, transferKeyValue)
      .field('collections', JSON.stringify(['users']))
      .field(
        'optionsMap',
        JSON.stringify({ users: { mode: ImportMode.insert } }),
      )
      .field('operatorUserId', OPERATOR_USER_ID)
      .field('uploadConfigs', JSON.stringify({}))
      .attach('transferDataZipFile', zipPath);

  const listUploadedZips = async (): Promise<string[]> =>
    (await fs.readdir(importsDir)).filter(
      (fileName) => path.extname(fileName) === '.zip',
    );

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'g2g-concurrency-'));
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

    receiverService = new G2GTransferReceiverService(crowi);
    crowi.g2gTransferReceiverService = receiverService;
    crowi.g2gTransferPusherService = mock<G2GTransferPusherService>();

    await configManager.loadConfigs();
    addCustomFunctionToResponse(express);

    app = express();
    app.use(setup(crowi));

    const keyString = await receiverService.createTransferKey(
      'http://g2g-concurrency-source.example.com',
    );
    transferKeyValue = TransferKey.parse(keyString).key;
  }, 120_000);

  afterEach(async () => {
    vi.restoreAllMocks();
    await User.deleteMany({
      _id: { $in: [FIRST_USER._id, SECOND_USER._id] },
    });
    const leftovers = await fs.readdir(importsDir);
    await Promise.all(
      leftovers.map((fileName) => fs.rm(path.join(importsDir, fileName))),
    );
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('refuses the second archive and does not let it near the first one’s files', async () => {
    let releaseImport: () => void = () => {};
    const importBlocked = new Promise<void>((resolve) => {
      releaseImport = resolve;
    });
    vi.spyOn(receiverService, 'importCollections').mockImplementation(
      async () => {
        await importBlocked;
        return { failedCollections: [] };
      },
    );

    const firstZip = await writeArchiveZip('first.growi.zip', [FIRST_USER]);
    const secondZip = await writeArchiveZip('second.growi.zip', [SECOND_USER]);

    // `.then` is what actually sends a supertest request.
    const firstInFlight = postArchive(firstZip).then((res) => res);
    // Give the first request time to get past the claim and unzip.
    await delay(200);

    const secondResponse = await postArchive(secondZip);

    expect(secondResponse.status).toBe(409);
    expect(secondResponse.body.errors[0].code).toBe(
      G2G_IMPORT_IN_PROGRESS_ERROR_CODE,
    );
    // The refusal came before multer wrote anything, so the first transfer's archive is
    // still the only one in the shared directory — the second could not have overwritten
    // the extracted files it is about to read.
    expect(await listUploadedZips()).toHaveLength(1);

    releaseImport();
    expect((await firstInFlight).status).toBe(200);
  });

  test('accepts the next import after an upload was rejected for not being a zip', async () => {
    // multer refuses the file and aborts the request, so the handler never runs — and
    // with it, any release written inside the handler.
    const rejected = await request(app)
      .post('/')
      .set(X_GROWI_TRANSFER_KEY_HEADER_NAME, transferKeyValue)
      .field('collections', JSON.stringify(['users']))
      .field(
        'optionsMap',
        JSON.stringify({ users: { mode: ImportMode.insert } }),
      )
      .field('operatorUserId', OPERATOR_USER_ID)
      .field('uploadConfigs', JSON.stringify({}))
      .attach('transferDataZipFile', Buffer.from('not a zip'), 'archive.txt');

    expect(rejected.status).not.toBe(200);

    const zipPath = await writeArchiveZip('after-reject.growi.zip', [
      FIRST_USER,
    ]);
    const accepted = await postArchive(zipPath);

    expect(accepted.status).toBe(200);
  });

  test('accepts the next import after a client abandoned one mid-request', async () => {
    // Nothing resolves this: the first request is abandoned while the import runs, which
    // is what a dropped connection during a large transfer looks like.
    vi.spyOn(receiverService, 'importCollections').mockImplementation(
      () => new Promise(() => {}),
    );

    const abandonedZip = await writeArchiveZip('abandoned.growi.zip', [
      FIRST_USER,
    ]);
    const abandoned = postArchive(abandonedZip);
    abandoned.end(() => {
      // The abort below rejects this request; that is the arrangement.
    });
    await delay(300);
    abandoned.abort();
    await delay(100);

    vi.restoreAllMocks();
    const zipPath = await writeArchiveZip('after-abort.growi.zip', [
      SECOND_USER,
    ]);

    expect((await postArchive(zipPath)).status).toBe(200);
  });
});
