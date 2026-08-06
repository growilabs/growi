/**
 * The transfer key has to survive a request that outlasts its own lifetime
 * (requirements 5.1, 5.2, 7.4).
 *
 * A transfer key is removed by a MongoDB TTL index 30 minutes after `expireAt`, and one
 * receive request can take longer than that on its own: the archive arrives over the
 * network, is unzipped, is checked against this GROWI's version, is compared against the
 * existing data, is imported collection by collection and finally triggers the v5 page
 * normalization — all before the response is written. If the key dies in the middle, the
 * destination ends up with a replaced database and not one attachment, which is the
 * failure this whole spec exists to remove.
 *
 * The tests drive the real router over HTTP and read `expireAt` back from the database.
 * The import itself is replaced by a promise the test controls: how long the request
 * takes is the arrangement here, not the thing under test, and a genuinely 30-minute
 * import is not something a test can arrange. The keep-alive interval is shortened
 * through the receiver service's constructor for the same reason.
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

import type { ITransferKey } from '~/interfaces/transfer-key';
import { ImportMode } from '~/models/admin/import-mode';
import type Crowi from '~/server/crowi';
import {
  setupIndependentModels,
  setupModelsDependentOnCrowi,
} from '~/server/crowi/setup-models';
import type UserEvent from '~/server/events/user';
import TransferKeyModel from '~/server/models/transfer-key';
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

/** Short enough that a test can watch it repeat, long enough not to flood the database. */
const KEEP_ALIVE_INTERVAL_MS = 100;

const CLEAN_USER = {
  _id: '0123456789abcdef01430001',
  username: 'g2g-keep-alive-user',
  email: 'g2g-keep-alive-user@example.com',
} as const;

const OPERATOR_USER_ID = '0123456789abcdef01430002';

const USERS_JSON = 'users.json';
const ZIP_NAME = 'g2g-keep-alive-transfer.zip';

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe('receive route — transfer key keep-alive', () => {
  let app: express.Application;
  let User: Model<IUser>;
  let receiverService: G2GTransferReceiverService;
  let tmpDir: string;
  let importsDir: string;
  let transferKeyValue: string;
  let zipPath: string;

  const readExpireAt = async (): Promise<number> => {
    const key = await TransferKeyModel.findOne<ITransferKey>({
      key: transferKeyValue,
    });
    if (key == null) {
      throw new Error('The transfer key is gone');
    }
    return new Date(key.expireAt).getTime();
  };

  const postArchive = (): request.Test =>
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

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'g2g-keep-alive-'));
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

    receiverService = new G2GTransferReceiverService(crowi, {
      transferKeyKeepAliveIntervalMs: KEEP_ALIVE_INTERVAL_MS,
    });
    crowi.g2gTransferReceiverService = receiverService;
    crowi.g2gTransferPusherService = mock<G2GTransferPusherService>();

    await configManager.loadConfigs();
    addCustomFunctionToResponse(express);

    app = express();
    app.use(setup(crowi));

    const keyString = await receiverService.createTransferKey(
      'http://g2g-keep-alive-source.example.com',
    );
    transferKeyValue = TransferKey.parse(keyString).key;

    const archive = archiver('zip');
    const output = createWriteStream(path.join(tmpDir, ZIP_NAME));
    const written = new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);
    });
    archive.pipe(output);
    archive.append(JSON.stringify({ version: getGrowiVersion() }), {
      name: 'meta.json',
    });
    archive.append(JSON.stringify([CLEAN_USER]), { name: USERS_JSON });
    await archive.finalize();
    await written;
    zipPath = path.join(tmpDir, ZIP_NAME);
  }, 120_000);

  afterEach(async () => {
    vi.restoreAllMocks();
    await User.deleteMany({ _id: CLEAN_USER._id });
    const leftovers = await fs.readdir(importsDir);
    await Promise.all(
      leftovers.map((fileName) => fs.rm(path.join(importsDir, fileName))),
    );
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('keeps the key alive for the whole request, so the attachments that follow are still accepted', async () => {
    let releaseImport: () => void = () => {};
    const importBlocked = new Promise<void>((resolve) => {
      releaseImport = resolve;
    });
    vi.spyOn(receiverService, 'importCollections').mockImplementation(
      async () => {
        await importBlocked;
      },
    );

    const inFlight = postArchive().then((res) => res);

    // Two samples taken inside the same request, several intervals apart. Comparing
    // against a reading from before the request would not say anything: touching the key
    // once, when the request arrives, moves `expireAt` too — and that single touch is
    // exactly what runs out while a long import is still going.
    await delay(KEEP_ALIVE_INTERVAL_MS * 2);
    const earlyInRequest = await readExpireAt();
    await delay(KEEP_ALIVE_INTERVAL_MS * 4);
    const laterInRequest = await readExpireAt();

    releaseImport();
    const response = await inFlight;
    expect(response.status).toBe(200);

    expect(laterInRequest).toBeGreaterThan(earlyInRequest);

    // What the pusher does next with the same key: post the attachments. A key that ran
    // out during the import answers this with 403 and the destination keeps a replaced
    // database with no attachments in it.
    const attachmentResponse = await request(app)
      .post('/attachment')
      .set(X_GROWI_TRANSFER_KEY_HEADER_NAME, transferKeyValue)
      .field('attachmentMetadata', JSON.stringify({ fileName: 'a.png' }))
      .attach('content', Buffer.from('irrelevant'), 'a.png');

    expect(attachmentResponse.status).not.toBe(403);
  });

  test('stops extending the key when the client disconnects mid-request', async () => {
    // Nothing releases this one: the request is abandoned while the import is running,
    // which is what a dropped connection during a large transfer looks like.
    vi.spyOn(receiverService, 'importCollections').mockImplementation(
      () => new Promise<void>(() => {}),
    );

    const pending = postArchive();
    pending.end(() => {
      // The abort below rejects the request; the failure is the point of the test.
    });

    await delay(KEEP_ALIVE_INTERVAL_MS * 3);
    const whileConnected = await readExpireAt();
    expect(whileConnected).toBeGreaterThan(0);

    pending.abort();
    await delay(KEEP_ALIVE_INTERVAL_MS);
    const justAfterDisconnect = await readExpireAt();

    await delay(KEEP_ALIVE_INTERVAL_MS * 4);

    // Left running, the key would never expire again — the 30-minute idle lifetime it is
    // supposed to have would be gone for good.
    expect(await readExpireAt()).toBe(justAfterDisconnect);
  });
});
