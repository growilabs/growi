/**
 * What one receive request owns in the shared import directory, and for how long.
 *
 * **The import claim** (requirements 2.7, 2.1). Two imports share one directory of
 * extracted JSON files and one database, so the second one overwrites the files the first
 * is about to read and empties collections underneath it. The window is wider than the
 * import itself: the receive route unzips the archive, re-reads it and queries the
 * destination for conflicts first, and on a large transfer that takes minutes.
 *
 * The claim is therefore taken in a middleware placed before multer, and it is given back
 * by whoever ends up owning the work. Both halves are load-bearing and are tested here:
 *
 * - taken any later, the upload itself is unprotected;
 * - given back when the *response* ends, it would be free while the import is still
 *   writing — express does not stop the handler when the client disconnects, so the retry
 *   an operator reaches for after a dropped transfer would walk straight into the first
 *   import's writes;
 * - never given back at all, a rejected or abandoned upload would refuse every import for
 *   the lifetime of the process.
 *
 * So the handler takes the claim over at its start and releases it in its own `finally`,
 * and the response's `close` only releases a claim the handler never got to take.
 *
 * **Getting the refusal back to the source.** The claim is checked from the headers, so
 * the refusal is decided while the archive is still arriving. Sent then, it does not reach
 * the source at all: the connection breaks under the unread upload and the pusher gets a
 * send error in its place, which is the one thing that would leave the operator without
 * the reason. So the route reads the archive to the end and throws it away first.
 *
 * **The received archive.** Each transfer now lands under a name of its own, and nothing
 * else in this route ever removes it — the only sweep of the import directory is the admin
 * screen's "delete all". Left behind, a wiki transferred twice would cost twice its size
 * on the destination's disk, for good. So the same `finally` deletes it, on success and on
 * failure alike.
 */

import { EventEmitter } from 'node:events';
import { createWriteStream, type ReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
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
import {
  getImportService,
  initializeImportService,
} from '~/server/service/import';
import type { ImportService } from '~/server/service/import/import';
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

describe('receive route POST / — the import claim and the received archive', () => {
  let app: express.Application;
  let User: Model<IUser>;
  let receiverService: G2GTransferReceiverService;
  let importService: ImportService;
  let tmpDir: string;
  let importsDir: string;
  let transferKeyValue: string;

  /**
   * Lets the import a test blocked run to completion. Re-armed by every `blockImport()`,
   * and called from `afterEach` as well as from the tests themselves.
   */
  let releaseBlockedImport: () => void = () => {};

  /**
   * Holds the receive route inside its import until `releaseBlockedImport()` is called,
   * and hands back a promise that settles the moment the import has actually begun — so a
   * test waits for the request to be *in* the import rather than guessing at a delay.
   */
  const blockImport = (): Promise<void> => {
    let signalImportStarted: () => void = () => {};
    const importStarted = new Promise<void>((resolve) => {
      signalImportStarted = resolve;
    });
    const importBlocked = new Promise<void>((resolve) => {
      releaseBlockedImport = resolve;
    });

    vi.spyOn(receiverService, 'importCollections').mockImplementation(
      async () => {
        signalImportStarted();
        await importBlocked;
        // Nothing was replaced, so nothing was rescued and no clean-up was needed;
        // what this test observes is the import claim, not the import's outcome.
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

    return importStarted;
  };

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
    importService = getImportService();
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
    // Unconditional, and before anything else. A test that releases its own blocked
    // import only after its assertions leaves the request hanging when one of them fails:
    // the response never closes, the claim never comes back, and every later test in this
    // file then fails with a misleading `expected 409 to be 200`.
    releaseBlockedImport();
    releaseBlockedImport = () => {};

    // Wait for the claim to actually come back before starting the next test. The route
    // releases it in the handler, which finishes a moment *after* the response the test
    // has already seen; acquiring it here is the only way to observe that it is free.
    await vi.waitFor(
      () => {
        const lease = importService.acquireImportJob();
        expect(lease).not.toBeNull();
        lease?.release();
      },
      { timeout: 10_000 },
    );

    vi.restoreAllMocks();
    await User.deleteMany({
      _id: { $in: [FIRST_USER._id, SECOND_USER._id] },
    });
    const leftovers = await fs.readdir(importsDir);
    await Promise.all(
      leftovers.map((fileName) =>
        // `force`, because the route deletes its own archive and may have got there first.
        fs.rm(path.join(importsDir, fileName), { force: true }),
      ),
    );
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('refuses the second archive and does not let it near the first one’s files', async () => {
    const importStarted = blockImport();

    const firstZip = await writeArchiveZip('first.growi.zip', [FIRST_USER]);
    const secondZip = await writeArchiveZip('second.growi.zip', [SECOND_USER]);

    // `.then` is what actually sends a supertest request.
    const firstInFlight = postArchive(firstZip).then((res) => res);
    await importStarted;

    const secondResponse = await postArchive(secondZip);

    expect(secondResponse.status).toBe(409);
    expect(secondResponse.body.errors[0].code).toBe(
      G2G_IMPORT_IN_PROGRESS_ERROR_CODE,
    );
    // The refusal came before multer wrote anything, so the first transfer's archive is
    // still the only one in the shared directory — the second could not have overwritten
    // the extracted files it is about to read.
    expect(await listUploadedZips()).toHaveLength(1);

    // `afterEach` releases this too, so a failed assertion above cannot leave the first
    // request hanging; released here as well because the first transfer must still be
    // able to finish, and that is worth asserting.
    releaseBlockedImport();
    expect((await firstInFlight).status).toBe(200);
  });

  test('holds the refusal back until the archive has finished arriving', async () => {
    const importStarted = blockImport();

    const firstZip = await writeArchiveZip('in-flight-first.growi.zip', [
      FIRST_USER,
    ]);
    const firstInFlight = postArchive(firstZip).then((res) => res);
    await importStarted;

    // A body that is still being written for a while after the request arrives, which is
    // what a real archive looks like and what the small files above finish too fast to be.
    let uploadEnded = false;
    let remainingChunks = 10;
    const archiveStillArriving = new Readable({
      read() {
        setTimeout(() => {
          if (remainingChunks-- > 0) {
            this.push(Buffer.alloc(1024));
            return;
          }
          uploadEnded = true;
          this.push(null);
        }, 20);
      },
    });

    const refused = await request(app)
      .post('/')
      .set(X_GROWI_TRANSFER_KEY_HEADER_NAME, transferKeyValue)
      .field('collections', JSON.stringify(['users']))
      .field(
        'optionsMap',
        JSON.stringify({ users: { mode: ImportMode.insert } }),
      )
      .field('operatorUserId', OPERATOR_USER_ID)
      .field('uploadConfigs', JSON.stringify({}))
      .attach(
        'transferDataZipFile',
        // supertest types the part as a file stream, while superagent sends any readable —
        // and a readable is the only way to keep the body arriving after the request has
        // begun, which is the whole situation under test.
        archiveStillArriving as unknown as ReadStream,
        'refused.growi.zip',
      );

    expect(refused.status).toBe(409);
    expect(refused.body.errors[0].code).toBe(G2G_IMPORT_IN_PROGRESS_ERROR_CODE);
    // The refusal is decided from the headers, so nothing here stops it from being sent
    // straight away — and sent then, over a body still on its way, it does not reach the
    // source at all: the connection breaks under the unread upload and the pusher gets a
    // `write EPIPE` send error in place of the response. Reading the archive to the end
    // first is what makes the answer above arrive, so that is what this asserts.
    expect(uploadEnded).toBe(true);

    // Let the transfer this test blocked finish, so it does not outlive the test.
    releaseBlockedImport();
    await firstInFlight;
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

  test('keeps refusing while an abandoned request’s import is still running, and accepts again once it ends', async () => {
    const importStarted = blockImport();

    const abandonedZip = await writeArchiveZip('abandoned.growi.zip', [
      FIRST_USER,
    ]);
    const abandoned = postArchive(abandonedZip);
    abandoned.end(() => {
      // The abort below rejects this request; that is the arrangement.
    });
    await importStarted;
    // What a connection dropped during a large transfer looks like from here.
    abandoned.abort();
    await delay(100);

    // The mocked import is now holding the abandoned request and nothing else. Put the
    // real one back before probing, so that a probe which wrongly gets through runs to
    // completion and fails on its status — a probe left on the mock would block on the
    // same promise and report a bare test timeout instead.
    vi.restoreAllMocks();

    // Express does not stop the handler when the client goes away, so the import that
    // request started is still writing. The retry an operator reaches for after a dropped
    // transfer — and, just as dangerous, an admin zip import, whose `deleteMany({})` would
    // run underneath these writes — must still be turned away.
    const refusedZip = await writeArchiveZip('after-abort.growi.zip', [
      SECOND_USER,
    ]);
    const refused = await postArchive(refusedZip);

    expect(refused.status).toBe(409);
    expect(refused.body.errors[0].code).toBe(G2G_IMPORT_IN_PROGRESS_ERROR_CODE);

    // And once that import ends, the claim comes back — released by the handler's own
    // `finally`, so an abandoned request cannot wedge the destination for the lifetime of
    // the process. Retried until then, because the release happens after the response the
    // abandoned client will never read.
    releaseBlockedImport();
    const retryZip = await writeArchiveZip('after-drain.growi.zip', [
      SECOND_USER,
    ]);
    await vi.waitFor(
      async () => {
        expect((await postArchive(retryZip)).status).toBe(200);
      },
      { timeout: 10_000 },
    );
    // The default 5s test timeout is shorter than the vi.waitFor budget above,
    // so this test can time out on its own even when everything it checks is
    // working correctly. Match the outer budget to the inner one plus room for
    // the rest of the test's own round-trips.
  }, 15_000);

  test('deletes the received archive once the transfer has finished', async () => {
    const zipPath = await writeArchiveZip('cleanup.growi.zip', [FIRST_USER]);

    expect((await postArchive(zipPath)).status).toBe(200);

    // Nobody else would: the route unzips in place, and the only sweep of the import
    // directory is the admin screen's "delete all". Waited for rather than asserted
    // outright, because the deletion happens just after the response.
    await vi.waitFor(async () => {
      expect(await listUploadedZips()).toHaveLength(0);
    });
  });

  test('deletes the received archive when the transfer failed', async () => {
    vi.spyOn(receiverService, 'importCollections').mockRejectedValue(
      new Error('import failed'),
    );

    const zipPath = await writeArchiveZip('cleanup-after-failure.growi.zip', [
      FIRST_USER,
    ]);

    expect((await postArchive(zipPath)).status).toBe(500);

    // A failed transfer leaves exactly as much on disk as a successful one, and it is the
    // one the operator retries — so the copies would pile up fastest here.
    await vi.waitFor(async () => {
      expect(await listUploadedZips()).toHaveLength(0);
    });
  });
});
