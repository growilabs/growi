/**
 * A transfer that only half succeeded must reach the operator as a failure
 * (requirements 2.5, 2.8) — and must still carry the attachments across
 * (requirement 5.2).
 *
 * The two GROWIs are separate processes. The operator watches progress notifications
 * emitted by the source, and the source cannot see what happened on the destination — so
 * the destination's answer to the archive is the one and only path this fact can take.
 * Until it was read, a transfer that left half of the collections behind was announced as
 * complete, and the operator found out from missing pages weeks later.
 *
 * Reading it is not enough on its own, though: stopping the transfer at that point left
 * the destination holding the collections that did import (`users` among them) and no
 * attachments at all, and a retry of the whole transfer is then refused by the unique
 * conflict gate precisely because those users are already there. The files go over
 * anyway, and the failure is reported after them.
 *
 * The test spans both sides: a real receive route on a real socket, a real import that
 * genuinely fails for one collection, a real attachment POST, and the real pusher reading
 * the response it gets back. Nothing about the hand-over is stubbed — only the
 * archive-building step (which would otherwise export the whole test database) and the
 * two file storages, which have no backend in a test process.
 */

import { EventEmitter } from 'node:events';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
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
import { AttachmentType } from '~/server/interfaces/attachment';
import type AppService from '~/server/service/app';
import { configManager } from '~/server/service/config-manager';
import instanciateExportService, {
  exportService,
} from '~/server/service/export';
import type { FileUploader } from '~/server/service/file-uploader';
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

const ATTACHMENT_CONTENT = 'g2g attachment payload';

/**
 * The one attachment this transfer has to carry. `fileName` / `fileSize` are what the
 * receive route matches against the `attachments` collection before it accepts the file,
 * so they have to describe the document below exactly.
 */
const ATTACHMENT = {
  fileName: 'g2g-partial-import-attachment.txt',
  fileFormat: 'text/plain',
  fileSize: Buffer.byteLength(ATTACHMENT_CONTENT),
  attachmentType: AttachmentType.WIKI_PAGE,
} as const;

type EmittedEvent = [event: string, payload: Record<string, unknown>];

describe('a partly failed import is reported to the source operator as a failure', () => {
  let app: express.Application;
  let server: Server;
  let tmpDir: string;
  let importsDir: string;
  let receiverCrowi: Crowi;

  /** The destination's attachment storage: where a transferred file ends up. */
  const receiverFileUploadService = mock<FileUploader>();
  /** The source's attachment storage: where a transferred file is read from. */
  const sourceFileUploadService = mock<FileUploader>();

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
      fileUploadService: receiverFileUploadService,
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
    await mongoose.connection
      .collection('attachments')
      .deleteMany({ fileName: ATTACHMENT.fileName });
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

  /**
   * Puts the one attachment this transfer must carry in the source's database, and makes
   * the destination report that it already holds every *other* file.
   *
   * The per-worker database is shared with the other integration files, and the source
   * sends every attachment the destination does not already have — so without narrowing
   * it this way, a leftover attachment from another file would join the transfer and its
   * own upload failure would show up as an extra `admin:g2gError`.
   */
  const setUpSingleAttachmentToTransfer = async (): Promise<void> => {
    await mongoose.connection
      .collection('attachments')
      .insertOne({ ...ATTACHMENT, createdAt: new Date() });

    const alreadyOnDestination = await mongoose.connection
      .collection('attachments')
      .find({ fileName: { $ne: ATTACHMENT.fileName } })
      .toArray();
    receiverFileUploadService.listFiles.mockResolvedValue(
      alreadyOnDestination.map(({ fileName, fileSize }) => ({
        name: fileName,
        size: fileSize,
      })),
    );

    sourceFileUploadService.findDeliveryFile.mockResolvedValue(
      Readable.from([ATTACHMENT_CONTENT]),
    );
    receiverFileUploadService.uploadAttachment.mockResolvedValue(undefined);
  };

  test('transfers the attachments and then notifies the failure with the collection names, instead of announcing completion', async () => {
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
        fileUploadService: sourceFileUploadService,
      }),
    );

    await setUpSingleAttachmentToTransfer();

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

    // The file really crossed to the destination: the source read it out of its storage,
    // posted it over the wire, and the destination's receive route handed it to its own
    // storage — none of which happens if the transfer stops at the failed import
    // (requirement 5.2).
    expect(
      receiverFileUploadService.uploadAttachment,
    ).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({ fileName: ATTACHMENT.fileName }),
    );

    const errorEvents = emitted.filter(([event]) => event === 'admin:g2gError');
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0][1]).toEqual({
      key: 'admin:g2g:error_partial_import',
      // Which collection was left out is the actionable part; a bare "it failed" would
      // leave the operator to work it out from the destination's logs.
      message: expect.stringContaining(BROKEN_COLLECTION),
    });
    // The failure is the last thing the operator hears. The admin screen hides the
    // progress panel as soon as an error arrives, so announcing it before the files went
    // over would replace a live view of the attachment transfer with silence.
    expect(emitted.at(-1)).toEqual(errorEvents[0]);

    const progressEvents = emitted
      .filter(([event]) => event === 'admin:g2gProgress')
      .map(([, payload]) => payload);
    expect(progressEvents.at(-1)).toEqual({
      // The attachments are through, but the collections that were left out keep the
      // mongo phase in error for the rest of the transfer.
      mongo: G2G_PROGRESS_STATUS.ERROR,
      attachments: G2G_PROGRESS_STATUS.COMPLETED,
      failedCollections: [BROKEN_COLLECTION],
    });
    // Nothing may say the transfer finished — that is the report this test exists to
    // prevent, and the attachment phase completing is exactly what could bring it back.
    expect(progressEvents).not.toContainEqual(
      expect.objectContaining({ mongo: G2G_PROGRESS_STATUS.COMPLETED }),
    );

    // The half that worked really was imported, so the failure above is about one
    // collection rather than about an import that never started.
    expect(
      await mongoose.connection
        .collection('tags')
        .findOne({ name: READABLE_TAG.name }),
    ).not.toBeNull();
  }, 60_000);
});
