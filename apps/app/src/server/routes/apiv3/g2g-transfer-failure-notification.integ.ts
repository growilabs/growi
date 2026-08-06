/**
 * A transfer that only half succeeded must reach the operator as a failure
 * (requirements 2.5, 2.8).
 *
 * The two GROWIs are separate processes. The operator watches progress notifications
 * emitted by the source, and the source cannot see what happened on the destination — so
 * the destination's answer to the archive is the one and only path this fact can take.
 * Until it was read, a transfer that left half of the collections behind was announced as
 * complete, and the operator found out from missing pages weeks later.
 *
 * The test spans both sides: a real receive route on a real socket, a real import that
 * genuinely fails for one collection, and the real pusher reading the response it gets
 * back. Nothing about the hand-over is stubbed — only the archive-building step, which
 * would otherwise export the whole test database.
 */

import { EventEmitter } from 'node:events';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import archiver from 'archiver';
import express from 'express';
import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import { G2G_PROGRESS_STATUS } from '~/interfaces/g2g-transfer';
import { ImportMode } from '~/models/admin/import-mode';
import type Crowi from '~/server/crowi';
import {
  setupIndependentModels,
  setupModelsDependentOnCrowi,
} from '~/server/crowi/setup-models';
import type UserEvent from '~/server/events/user';
import type AppService from '~/server/service/app';
import { configManager } from '~/server/service/config-manager';
import instanciateExportService, {
  exportService,
} from '~/server/service/export';
import {
  G2GTransferPusherService,
  G2GTransferReceiverService,
  type IDataGROWIInfo,
} from '~/server/service/g2g-transfer';
import { GrowiBridgeService } from '~/server/service/growi-bridge';
import { initializeImportService } from '~/server/service/import';
import type { SocketIoService } from '~/server/service/socket-io';
import { getGrowiVersion } from '~/utils/growi-version';
import { TransferKey } from '~/utils/vo/transfer-key';

import { setup } from './g2g-transfer';
import addCustomFunctionToResponse from './response';

const G2G_TRANSFER_ROUTE_PREFIX = '/_api/v3/g2g-transfer';

const READABLE_TAG = {
  _id: '0123456789abcdef01480001',
  name: 'g2g-partial-import-tag',
} as const;

/** A closing bracket where a value belongs — one of the few shapes the parser rejects. */
const UNPARSEABLE_JSON = '[{"a":]}]';

const TRANSFERRED_COLLECTIONS = ['tags', 'pagetagrelations'] as const;
const BROKEN_COLLECTION = 'pagetagrelations';

type EmittedEvent = [event: string, payload: Record<string, unknown>];

describe('a partly failed import is reported to the source operator as a failure', () => {
  let app: express.Application;
  let server: Server;
  let tmpDir: string;
  let importsDir: string;
  let receiverCrowi: Crowi;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'g2g-partial-import-'));
    importsDir = path.join(tmpDir, 'imports');
    await fs.mkdir(importsDir, { recursive: true });

    receiverCrowi = mock<Crowi>({
      tmpDir,
      events: {
        page: mock<EventEmitter>(),
        user: mock<UserEvent>(),
        admin: new EventEmitter(),
      },
      appService: mock<AppService>(),
    });
    receiverCrowi.growiBridgeService = new GrowiBridgeService(receiverCrowi);
    initializeImportService(receiverCrowi);
    instanciateExportService(receiverCrowi);

    await setupModelsDependentOnCrowi(receiverCrowi);
    await setupIndependentModels();

    receiverCrowi.g2gTransferReceiverService = new G2GTransferReceiverService(
      receiverCrowi,
    );
    receiverCrowi.g2gTransferPusherService = mock<G2GTransferPusherService>();

    await configManager.loadConfigs();
    addCustomFunctionToResponse(express);

    app = express();
    app.use(G2G_TRANSFER_ROUTE_PREFIX, setup(receiverCrowi));
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, () => {
        resolve(listening);
      });
    });
  }, 120_000);

  afterEach(async () => {
    vi.restoreAllMocks();
    await mongoose.connection
      .collection('tags')
      .deleteMany({ name: READABLE_TAG.name });
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

  /** An archive whose `pagetagrelations` the destination will not be able to read. */
  const writeArchiveWithOneBrokenCollection = async (): Promise<string> => {
    const zipPath = path.join(tmpDir, 'partial.growi.zip');
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
    archive.append(JSON.stringify([READABLE_TAG]), { name: 'tags.json' });
    archive.append(UNPARSEABLE_JSON, { name: `${BROKEN_COLLECTION}.json` });
    await archive.finalize();
    await written;

    return zipPath;
  };

  test('notifies the failure with the collection names instead of announcing completion', async () => {
    const emitted: EmittedEvent[] = [];
    const adminSocket = mock<ReturnType<SocketIoService['getAdminSocket']>>();
    adminSocket.emit.mockImplementation(((
      event: string,
      payload: Record<string, unknown>,
    ) => {
      emitted.push([event, payload]);
      return true;
    }) as typeof adminSocket.emit);
    const socketIoService = mock<SocketIoService>();
    socketIoService.getAdminSocket.mockReturnValue(adminSocket);

    const pusher = new G2GTransferPusherService(
      mock<Crowi>({
        socketIoService,
        appService: mock<AppService>(),
      }),
    );

    if (exportService == null) {
      throw new Error('Expected the export service to be instantiated');
    }
    const zipFilePath = await writeArchiveWithOneBrokenCollection();
    vi.spyOn(exportService, 'export').mockResolvedValue({
      zipFilePath,
    } as Awaited<ReturnType<typeof exportService.export>>);

    const { port } = server.address() as AddressInfo;
    const keyString = await new G2GTransferReceiverService(
      receiverCrowi,
    ).createTransferKey(`http://127.0.0.1:${port}`);

    await pusher.startTransfer(
      TransferKey.parse(keyString),
      { _id: new mongoose.Types.ObjectId() },
      [...TRANSFERRED_COLLECTIONS],
      Object.fromEntries(
        TRANSFERRED_COLLECTIONS.map((collectionName) => [
          collectionName,
          { mode: ImportMode.insert },
        ]),
      ),
      mock<IDataGROWIInfo>(),
    );

    const errorEvents = emitted.filter(([event]) => event === 'admin:g2gError');
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0][1]).toEqual({
      key: 'admin:g2g:error_partial_import',
      // Which collection was left out is the actionable part; a bare "it failed" would
      // leave the operator to work it out from the destination's logs.
      message: expect.stringContaining(BROKEN_COLLECTION),
    });

    const progressEvents = emitted
      .filter(([event]) => event === 'admin:g2gProgress')
      .map(([, payload]) => payload);
    expect(progressEvents.at(-1)).toEqual({
      mongo: G2G_PROGRESS_STATUS.ERROR,
      attachments: G2G_PROGRESS_STATUS.PENDING,
      failedCollections: [BROKEN_COLLECTION],
    });
    // Nothing may say the transfer finished — that is the report this test exists to
    // prevent.
    expect(progressEvents).not.toContainEqual({
      mongo: G2G_PROGRESS_STATUS.COMPLETED,
      attachments: G2G_PROGRESS_STATUS.COMPLETED,
    });

    // The half that worked really was imported, so the failure above is about one
    // collection rather than about an import that never started.
    expect(
      await mongoose.connection
        .collection('tags')
        .findOne({ name: READABLE_TAG.name }),
    ).not.toBeNull();
  }, 60_000);
});
