/**
 * Route-level integration test for the push side's execution-time re-check
 * (task 10.2's non-negotiable, the server-side counterpart of requirements 3.1-3.3).
 *
 * The confirm modal shows the operator a `preflight` report and only asks them to
 * confirm once; time still passes between that confirmation and the `POST /transfer`
 * call that actually starts the transfer (the operator has to read the modal, then
 * click). If the destination drifted into a blocked state during that window,
 * `/transfer` must refuse to start rather than trust the stale "it was fine a moment
 * ago" answer preflight gave.
 *
 * This spans both sides for real: a real destination GROWI answering `growi-info` over
 * a real socket, and the real `G2GTransferPusherService.getTransferability` (which now
 * delegates to the same `evaluateTransferability` judgement `preflight` uses -- see
 * `evaluateAgainstDestination` in `service/g2g-transfer.ts`) judging it. `startTransfer`
 * itself is stubbed out (it would otherwise generate a real archive and post it), so
 * what is asserted is purely "did the execution-time check let it proceed", read off
 * both the response and whether `startTransfer` was ever called.
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { IUser } from '@growi/core';
import express from 'express';
import mongoose, { type Model } from 'mongoose';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import {
  setupIndependentModels,
  setupModelsDependentOnCrowi,
} from '~/server/crowi/setup-models';
import type UserEvent from '~/server/events/user';
import { UserStatus } from '~/server/models/user/conts';
import type AppService from '~/server/service/app';
import { configManager } from '~/server/service/config-manager';
import instanciateExportService from '~/server/service/export';
import type { FileUploader } from '~/server/service/file-uploader';
import {
  G2GTransferPusherService,
  G2GTransferReceiverService,
} from '~/server/service/g2g-transfer';
import { GrowiBridgeService } from '~/server/service/growi-bridge';
import { initializeImportService } from '~/server/service/import';
import type PassportService from '~/server/service/passport';

import { setup } from './g2g-transfer';
import addCustomFunctionToResponse from './response';

/** Where production mounts this router; the pusher's `askGROWIInfo` posts here. */
const G2G_TRANSFER_ROUTE_PREFIX = '/_api/v3/g2g-transfer';

const ADMIN_CALLER = {
  _id: '0123456789abcdef014c0001',
  admin: true,
  status: UserStatus.STATUS_ACTIVE, // what loginRequiredStrictly checks for
} as const;

describe('push route POST /transfer — re-runs the transferability judgement at execution time', () => {
  let receiverServer: Server;
  let receiverCrowi: Crowi;
  let sourceCrowi: Crowi;
  let User: Model<IUser>;
  let tmpDir: string;
  let transferKeyString: string;
  // Kept as its own typed handle (rather than read back off `sourceCrowi.
  // g2gTransferPusherService`, which the class declares as `G2GTransferPusherService |
  // null`) so `vi.spyOn` below resolves against the real class, not the nullable union.
  let pusherService: G2GTransferPusherService;
  let startTransferSpy: ReturnType<typeof vi.spyOn>;

  /**
   * Read by the destination's `isWritable` mock at call time, the same shape the
   * preflight integ test uses to flip a blocker condition without rebuilding the
   * fixture. This is the one blocker this file's fixtures can trigger without
   * touching config internals (matching versions, unlimited upload quotas).
   */
  let destinationIsWritable = true;

  const buildSourceApp = (): express.Application => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as express.Request & { user: unknown }).user = ADMIN_CALLER;
      next();
    });
    app.use(G2G_TRANSFER_ROUTE_PREFIX, setup(sourceCrowi));
    return app;
  };

  const askPreflight = (app: express.Application): request.Test =>
    request(app)
      .post(`${G2G_TRANSFER_ROUTE_PREFIX}/preflight`)
      .send({ transferKey: transferKeyString });

  const postTransfer = (app: express.Application): request.Test =>
    request(app)
      .post(`${G2G_TRANSFER_ROUTE_PREFIX}/transfer`)
      .send({
        transferKey: transferKeyString,
        collections: ['users'],
        optionsMap: { users: { mode: 'insert' } },
      });

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'g2g-exec-recheck-'));
    await fs.mkdir(path.join(tmpDir, 'imports'), { recursive: true });

    // --- destination (receiver) side: a real listening server ---
    receiverCrowi = mock<Crowi>({
      tmpDir,
      env: {},
      events: {
        page: mock<EventEmitter>(),
        user: mock<UserEvent>(),
        admin: new EventEmitter(),
      },
      appService: mock<AppService>(),
      fileUploadService: mock<FileUploader>({
        getFileUploadTotalLimit: () => Number.POSITIVE_INFINITY,
        isWritable: async () => destinationIsWritable,
      }),
    });
    receiverCrowi.growiBridgeService = new GrowiBridgeService(receiverCrowi);
    initializeImportService(receiverCrowi);
    instanciateExportService(receiverCrowi);

    await setupModelsDependentOnCrowi(receiverCrowi);
    await setupIndependentModels();
    User = mongoose.model<IUser>('User');

    const receiverService = new G2GTransferReceiverService(receiverCrowi);
    receiverCrowi.g2gTransferReceiverService = receiverService;
    // Nothing here pushes a transfer; the receiver router only refuses to be built
    // without one.
    receiverCrowi.g2gTransferPusherService = mock<G2GTransferPusherService>();

    await configManager.loadConfigs();
    addCustomFunctionToResponse(express);

    const receiverApp = express();
    receiverApp.use(G2G_TRANSFER_ROUTE_PREFIX, setup(receiverCrowi));
    receiverServer = await new Promise<Server>((resolve) => {
      const listening = receiverApp.listen(0, () => {
        resolve(listening);
      });
    });

    const { port } = receiverServer.address() as AddressInfo;
    transferKeyString = await receiverService.createTransferKey(
      `http://127.0.0.1:${port}`,
    );

    // --- source (pusher) side: the real router under test, driven with supertest ---
    sourceCrowi = mock<Crowi>({
      env: {},
      fileUploadService: mock<FileUploader>({
        getTotalFileSize: async () => 0,
      }),
      passportService: mock<PassportService>({ isLocalStrategySetup: true }),
    });
    sourceCrowi.growiBridgeService = new GrowiBridgeService(sourceCrowi);
    pusherService = new G2GTransferPusherService(sourceCrowi);
    sourceCrowi.g2gTransferPusherService = pusherService;
    // The push router's setup() guard only requires this to be non-null; /transfer's
    // execution-time check never calls a receiver-service method on the source side.
    sourceCrowi.g2gTransferReceiverService = mock<G2GTransferReceiverService>();
  }, 120_000);

  beforeEach(() => {
    // Stubbed rather than left real: a real call would generate an archive from this
    // process's own database and POST it to the destination, none of which this test
    // needs -- it only needs to observe whether the execution-time check let the route
    // reach this call at all.
    startTransferSpy = vi
      .spyOn(pusherService, 'startTransfer')
      .mockResolvedValue(undefined);
  });

  afterEach(async () => {
    destinationIsWritable = true;
    startTransferSpy.mockRestore();
    await User.deleteMany({ _id: ADMIN_CALLER._id });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      receiverServer.close(() => resolve());
    });
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('starts the transfer when the destination is still compatible', async () => {
    const app = buildSourceApp();

    const preflightResponse = await askPreflight(app);
    expect(preflightResponse.status).toBe(200);
    expect(preflightResponse.body.blockers).toEqual([]);

    const transferResponse = await postTransfer(app);

    expect(transferResponse.status).toBe(200);
    expect(startTransferSpy).toHaveBeenCalledTimes(1);
  });

  test('refuses to start when the destination drifted into a blocked state after preflight confirmed it was fine', async () => {
    // Requirement 3.1-3.3's server-side counterpart, and this task's core
    // non-negotiable: a confirmation the operator gave while looking at a clean
    // preflight report must not let a transfer start against a destination that has
    // since become incompatible.
    const app = buildSourceApp();

    const preflightResponse = await askPreflight(app);
    expect(preflightResponse.status).toBe(200);
    expect(preflightResponse.body.blockers).toEqual([]);

    // The destination drifts into a blocked state in the window between the operator
    // reading the confirm modal and clicking confirm.
    destinationIsWritable = false;

    const transferResponse = await postTransfer(app);

    expect(transferResponse.body.errors?.[0]?.code).toBe(
      'growi_incompatible_to_transfer',
    );
    // The one assertion that actually proves nothing started: a route that returned an
    // error page but still kicked off `startTransfer` in the background would pass
    // every assertion above while still generating an archive and posting it.
    expect(startTransferSpy).not.toHaveBeenCalled();
  });
});
