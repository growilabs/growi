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
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
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
import instanciateExportService, {
  exportService,
} from '~/server/service/export';
import {
  G2GTransferPusherService,
  G2GTransferReceiverService,
  type IDataGROWIInfo,
  X_GROWI_TRANSFER_KEY_HEADER_NAME,
} from '~/server/service/g2g-transfer';
import { GrowiBridgeService } from '~/server/service/growi-bridge';
import { initializeImportService } from '~/server/service/import';
import type { SocketIoService } from '~/server/service/socket-io';
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

/** Where apiv3 mounts this router in production; the pusher posts to absolute paths. */
const G2G_TRANSFER_ROUTE_PREFIX = '/_api/v3/g2g-transfer';

const USERS_JSON = 'users.json';
const ZIP_NAME = 'g2g-keep-alive-transfer.zip';

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe('receive route — transfer key keep-alive', () => {
  let app: express.Application;
  let crowi: Crowi;
  let server: Server;
  let User: Model<IUser>;
  let receiverService: G2GTransferReceiverService;
  let tmpDir: string;
  let importsDir: string;
  let transferKeyValue: string;
  let zipPath: string;

  const readExpireAt = async (key = transferKeyValue): Promise<number> => {
    const transferKeyDoc = await TransferKeyModel.findOne<ITransferKey>({
      key,
    });
    if (transferKeyDoc == null) {
      throw new Error('The transfer key is gone');
    }
    return new Date(transferKeyDoc.expireAt).getTime();
  };

  const postArchive = (): request.Test =>
    request(app)
      .post(`${G2G_TRANSFER_ROUTE_PREFIX}/`)
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

    crowi = mock<Crowi>({
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
    // Mounted where production mounts it: the pusher builds absolute apiv3 paths.
    app.use(G2G_TRANSFER_ROUTE_PREFIX, setup(crowi));
    // The pusher reaches the destination over the network, so the destination has to be
    // a real listening server rather than a supertest-driven handler.
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, () => {
        resolve(listening);
      });
    });

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
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
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
        // Nothing was replaced, so nothing was rescued and no clean-up was needed;
        // what this test observes is the key's lifetime, not the import's outcome.
        return {
          failedCollections: [],
          importAborted: false,
          rescue: null,
          rescueApplied: false,
          postProcessFailures: [],
          maintenanceModeReleased: false,
        };
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
      .post(`${G2G_TRANSFER_ROUTE_PREFIX}/attachment`)
      .set(X_GROWI_TRANSFER_KEY_HEADER_NAME, transferKeyValue)
      .field('attachmentMetadata', JSON.stringify({ fileName: 'a.png' }))
      .attach('content', Buffer.from('irrelevant'), 'a.png');

    expect(attachmentResponse.status).not.toBe(403);
  });

  test('stops extending the key when the client disconnects mid-request', async () => {
    // Nothing releases this one: the request is abandoned while the import is running,
    // which is what a dropped connection during a large transfer looks like.
    vi.spyOn(receiverService, 'importCollections').mockImplementation(
      () => new Promise(() => {}),
    );

    const pending = postArchive();
    pending.end(() => {
      // The abort below rejects the request; the failure is the point of the test.
    });

    await delay(KEEP_ALIVE_INTERVAL_MS * 3);
    const whileConnected = await readExpireAt();
    expect(whileConnected).toBeGreaterThan(0);

    pending.abort();
    // Long enough for an extension that was already under way to finish writing.
    await delay(KEEP_ALIVE_INTERVAL_MS * 3);
    const justAfterDisconnect = await readExpireAt();

    await delay(KEEP_ALIVE_INTERVAL_MS * 4);

    // Left running, the key would never expire again — the 30-minute idle lifetime it is
    // supposed to have would be gone for good.
    expect(await readExpireAt()).toBe(justAfterDisconnect);
  });

  describe('while the source builds the archive', () => {
    test('the source keeps the destination’s key alive, and stops once the archive is ready', async () => {
      // Exporting and zipping is one uninterrupted stretch on the source during which the
      // destination is never contacted. This drives the real pusher against the real
      // receive route over a real socket, so what is asserted is the destination's own
      // record of the key rather than a call count on the source.
      const { port } = server.address() as AddressInfo;
      const keyString = await receiverService.createTransferKey(
        `http://127.0.0.1:${port}`,
      );
      const tk = TransferKey.parse(keyString);

      const pusher = new G2GTransferPusherService(
        // startTransfer reports its progress over the admin socket before it does
        // anything else.
        mock<Crowi>({ socketIoService: mock<SocketIoService>() }),
        { transferKeyKeepAliveIntervalMs: KEEP_ALIVE_INTERVAL_MS },
      );

      // Whether the export succeeds is beside the point; its duration is the arrangement.
      // Failing it ends startTransfer right after the stretch under test.
      if (exportService == null) {
        throw new Error('Expected the export service to be instantiated');
      }
      vi.spyOn(exportService, 'export').mockImplementation(async () => {
        await delay(KEEP_ALIVE_INTERVAL_MS * 6);
        throw new Error('export failed on purpose');
      });

      const before = await readExpireAt(tk.key);

      const transferring = pusher
        .startTransfer(
          tk,
          { _id: new mongoose.Types.ObjectId() },
          ['users'],
          { users: { mode: ImportMode.insert } },
          mock<IDataGROWIInfo>(),
        )
        .catch(() => {
          // The deliberately failed export.
        });

      await delay(KEEP_ALIVE_INTERVAL_MS * 2);
      const earlyInExport = await readExpireAt(tk.key);
      await delay(KEEP_ALIVE_INTERVAL_MS * 3);
      const laterInExport = await readExpireAt(tk.key);

      await transferring;

      // Without this, nothing reaches the destination between the growi-info call and the
      // archive itself, so a long export runs the key out before the archive is handed
      // over at all — and then not one byte of the transfer has arrived.
      expect(earlyInExport).toBeGreaterThan(before);
      expect(laterInExport).toBeGreaterThan(earlyInExport);

      // Everything after the export is itself a request to the destination, so the
      // reminder has to stop; left running it would hold the key open indefinitely.
      // The wait before the baseline lets a request that was already on its way when the
      // reminder stopped arrive, so the baseline is not taken in the middle of one.
      await delay(KEEP_ALIVE_INTERVAL_MS * 3);
      const afterExport = await readExpireAt(tk.key);
      await delay(KEEP_ALIVE_INTERVAL_MS * 4);
      expect(await readExpireAt(tk.key)).toBe(afterExport);
    });
  });
});
