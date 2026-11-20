/**
 * Route-level integration test for the push side's pre-transfer inspection
 * (requirements 3.1, 3.3, 3.4, 3.5, 3.7).
 *
 * The admin who is about to start a migration transfer needs to see what it would
 * delete and be warned before anything irreversible happens, and that answer has to be
 * trustworthy: this test spans both sides for real — a real destination GROWI answering
 * `growi-info` over a real socket, and a real `G2GTransferPusherService.preflight` on
 * the source reading its own database and judging the result — so the counts and
 * warnings asserted below come from the same code path production uses, not from a
 * stub standing in for either side.
 *
 * What preflight must never do is change the destination (requirement 3.3), and the
 * only way to prove that is a snapshot taken before and after the call, compared for
 * equality — not "the call did not throw". This mirrors the `snapshotDestination()`
 * used by the receive-route conflict-gate test (`g2g-transfer.integ.ts`), over the same
 * four collections.
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

const PREFIX = 'g2g-preflight';

/** Fixture prefix ensures deltas below are attributable to this file, not leftovers. */
const EXTRA_DESTINATION_USER = {
  username: `${PREFIX}-extra-user`,
  email: `${PREFIX}-extra-user@example.com`,
} as const;

const ADMIN_CALLER = {
  _id: '0123456789abcdef01450001',
  admin: true,
  status: UserStatus.STATUS_ACTIVE, // what loginRequiredStrictly checks for
} as const;

const NON_ADMIN_CALLER = {
  _id: '0123456789abcdef01450002',
  admin: false,
  status: UserStatus.STATUS_ACTIVE,
} as const;

/**
 * Admin, but not active. `loginRequiredStrictly` rejects this on `status` alone,
 * before `adminRequired` ever runs — `adminRequired` only reads `.admin`, so it would
 * wave this caller straight through. This is the fixture that catches
 * `loginRequiredStrictly` being dropped from the chain, which `NON_ADMIN_CALLER` above
 * cannot: removing `loginRequiredStrictly` still leaves `NON_ADMIN_CALLER` refused by
 * `adminRequired`'s own `.admin` check.
 */
const SUSPENDED_ADMIN_CALLER = {
  _id: '0123456789abcdef01450003',
  admin: true,
  status: UserStatus.STATUS_SUSPENDED,
} as const;

/** The four collections a migration transfer would replace; the same set the receive
 * route's own conflict-gate test snapshots. */
const SNAPSHOT_COLLECTIONS = [
  'users',
  'usergroups',
  'usergrouprelations',
  'pages',
] as const;

describe('push route POST /preflight — inspects the destination without changing it', () => {
  let receiverServer: Server;
  let receiverCrowi: Crowi;
  let sourceCrowi: Crowi;
  let sourcePassportServiceMock: PassportService;
  let User: Model<IUser>;
  let tmpDir: string;
  let transferKeyString: string;

  /**
   * Read by the destination's `isWritable` mock at call time (a mutable local, the
   * same shape as `sourcePassportServiceMock.isLocalStrategySetup`), so a test can
   * flip the destination's writability without rebuilding the fixture. In the default
   * process-wide fixtures (matching versions, unlimited upload quota on both sides,
   * `app:fileUploadType` defaulting to `aws`), this is the only blocker condition a
   * test can trigger without reaching into config internals.
   */
  let destinationIsWritable = true;

  /**
   * Counts every request the destination's HTTP server actually receives. A snapshot
   * match proves the destination's *data* did not change; it says nothing about
   * whether the destination was ever asked anything (a successful preflight also
   * leaves the snapshot unchanged). This counter is what lets a test assert "the
   * source never even contacted the destination" for real.
   */
  let destinationRequestCount = 0;

  /**
   * Builds a fresh source-side app so each test controls exactly who `req.user` is.
   *
   * Mounted at `G2G_TRANSFER_ROUTE_PREFIX`, the same path production mounts this
   * router at — not at the app root. `loginRequiredStrictly`'s "nobody is logged in"
   * fallback branches on whether `req.baseUrl` matches `/^\/_api\/.+$/`: mounted at
   * root that branch is never taken (baseUrl is `''`) and the caller is redirected;
   * mounted here, exactly as production does, the caller gets a 403. Mounting at root
   * would pin a response this endpoint never actually returns.
   */
  const buildSourceApp = (
    user?: Record<string, unknown>,
  ): express.Application => {
    const app = express();
    app.use(express.json());
    if (user != null) {
      app.use((req, _res, next) => {
        (req as express.Request & { user: unknown }).user = user;
        next();
      });
    }
    app.use(G2G_TRANSFER_ROUTE_PREFIX, setup(sourceCrowi));
    return app;
  };

  const askPreflight = (
    app: express.Application,
    body: Record<string, unknown> = { transferKey: transferKeyString },
  ): request.Test =>
    request(app).post(`${G2G_TRANSFER_ROUTE_PREFIX}/preflight`).send(body);

  // Whole-collection snapshots (raw driver reads), like g2g-transfer.integ.ts's own
  // snapshotDestination — `expireAt` on the transfer key is deliberately not one of
  // these four collections: preflight extends it on arrival, and that is accepted
  // (design.md, Security Considerations / Performance & Scalability).
  const snapshotDestination = async (): Promise<unknown> => {
    const snapshots = await Promise.all(
      SNAPSHOT_COLLECTIONS.map((collectionName) =>
        mongoose.connection
          .collection(collectionName)
          .find({})
          .sort({ _id: 1 })
          .toArray(),
      ),
    );
    return Object.fromEntries(
      SNAPSHOT_COLLECTIONS.map((collectionName, i) => [
        collectionName,
        snapshots[i],
      ]),
    );
  };

  const removeFixtures = async (): Promise<void> => {
    await User.deleteMany({ username: EXTRA_DESTINATION_USER.username });
  };

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'g2g-preflight-'));
    await fs.mkdir(path.join(tmpDir, 'imports'), { recursive: true });

    // --- destination (receiver) side: a real listening server ---
    receiverCrowi = mock<Crowi>({
      tmpDir,
      env: { PASSWORD_SEED: 'g2g-preflight-destination-seed' },
      events: {
        page: mock<EventEmitter>(),
        user: mock<UserEvent>(),
        admin: new EventEmitter(),
      },
      appService: mock<AppService>(),
      // The attachment side of growi-info is pre-existing behavior this file does not
      // touch; it only has to be answerable without a real storage backend.
      // `isWritable` reads `destinationIsWritable` at call time rather than closing
      // over a fixed value, so a test can flip it later (see the field's own doc).
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
    // Counts every request that reaches the destination's server at all — see
    // destinationRequestCount's own doc. Placed ahead of the real router so it counts
    // requests the router itself would refuse too (there are none of those in this
    // file, but the point is to observe arrival, not routing outcome).
    receiverApp.use((_req, _res, next) => {
      destinationRequestCount += 1;
      next();
    });
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
    sourcePassportServiceMock = mock<PassportService>({
      isLocalStrategySetup: true,
    });
    sourceCrowi = mock<Crowi>({
      env: { PASSWORD_SEED: 'g2g-preflight-source-seed' },
      fileUploadService: mock<FileUploader>({
        getTotalFileSize: async () => 0,
      }),
      passportService: sourcePassportServiceMock,
    });
    sourceCrowi.growiBridgeService = new GrowiBridgeService(sourceCrowi);
    sourceCrowi.g2gTransferPusherService = new G2GTransferPusherService(
      sourceCrowi,
    );
    // The push router's setup() guard only requires this to be non-null; preflight
    // never calls a receiver-service method on the source side.
    sourceCrowi.g2gTransferReceiverService = mock<G2GTransferReceiverService>();

    await removeFixtures();
  }, 120_000);

  afterEach(async () => {
    sourcePassportServiceMock.isLocalStrategySetup = true;
    destinationIsWritable = true;
    destinationRequestCount = 0;
    await removeFixtures();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      receiverServer.close(() => resolve());
    });
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('reports the destination’s real counts and leaves it exactly as it was', async () => {
    // Requirements 3.1, 3.3 — the operator is shown how much of the destination goes
    // away, and asking must not itself be one of the things that changes it.
    const app = buildSourceApp(ADMIN_CALLER);
    const requestsBefore = destinationRequestCount;

    const before = await snapshotDestination();
    const beforeCounts = (await askPreflight(app)).body.destinationCounts;

    await User.create({ ...EXTRA_DESTINATION_USER });

    const response = await askPreflight(app);

    expect(response.status).toBe(200);
    // Self-check for the counter the "never asks the destination anything" tests
    // below rely on: two successful preflights above must have reached the
    // destination's server exactly twice. Without this, `destinationRequestCount`
    // could stop incrementing entirely and every one of those tests would still pass
    // (0 before, 0 after) — which is exactly what happened before this assertion
    // existed.
    expect(destinationRequestCount).toBe(requestsBefore + 2);
    expect(response.body.destinationCounts.users - beforeCounts.users).toBe(1);
    // Paired with the "not writable" case below: an ordinary call between two
    // otherwise-compatible GROWIs raises no blocker at all. Asserting the exact empty
    // array (not just "it's an array") is what makes that pairing mean something —
    // without it, a `blockers` that silently stopped reflecting reality would still
    // read as "an array" forever.
    expect(response.body.blockers).toEqual([]);
    expect(Array.isArray(response.body.warnings)).toBe(true);
    // Requirement 3.4 — the source and destination were given different password
    // seeds above, so the real `evaluateTransferability` wiring (not a stand-in) has
    // to notice and warn about it.
    expect(response.body.warnings).toContainEqual({
      type: 'password_seed_mismatch',
    });

    // Requirement 3.6's sibling constraint on this answer, and the non-negotiable that
    // nothing more than numbers travels here: no username, email, seed or hash.
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(EXTRA_DESTINATION_USER.username);
    expect(serialized).not.toContain(EXTRA_DESTINATION_USER.email);
    expect(serialized).not.toContain('g2g-preflight-destination-seed');
    expect(serialized).not.toContain('g2g-preflight-source-seed');

    await User.deleteOne({ username: EXTRA_DESTINATION_USER.username });

    // The two calls above and the fixture insert/delete in between are the only writes
    // in this test; none of them touched the destination itself through preflight.
    expect(await snapshotDestination()).toEqual(before);
  });

  test('warns when the source has disabled local authentication, and stops warning once it is re-enabled', async () => {
    // Requirement 3.7's fourth warning — a rescued destination administrator can only
    // still use a password if the source (whose configs always replace the
    // destination's) has local auth enabled. This is the one input the route has to
    // compute for itself rather than read off the destination's answer, so the test
    // proves it is wired to the real flag rather than a fabricated constant.
    const app = buildSourceApp(ADMIN_CALLER);

    sourcePassportServiceMock.isLocalStrategySetup = false;
    const disabledResponse = await askPreflight(app);
    expect(disabledResponse.status).toBe(200);
    expect(disabledResponse.body.warnings).toContainEqual({
      type: 'local_auth_disabled_at_source',
    });

    sourcePassportServiceMock.isLocalStrategySetup = true;
    const enabledResponse = await askPreflight(app);
    expect(enabledResponse.status).toBe(200);
    expect(enabledResponse.body.warnings).not.toContainEqual({
      type: 'local_auth_disabled_at_source',
    });
  });

  test('reports a blocker when the destination storage is not writable', async () => {
    // Requirement 3.1's sibling: `blockers` is one of the three things this endpoint
    // returns and task 10.2 reads it to decide whether to let a transfer start at
    // all, so it has to reflect a real condition, not just be present as an array.
    // Every other blocker in `evaluateBlockers` needs a fixture this file cannot
    // reach without touching config internals (matching versions, an unlimited
    // upload quota on both sides, `app:fileUploadType` defaulting to `aws`) — an
    // unwritable destination is the one this file's own fixtures can flip.
    const app = buildSourceApp(ADMIN_CALLER);
    destinationIsWritable = false;

    const response = await askPreflight(app);

    expect(response.status).toBe(200);
    expect(response.body.blockers).toContainEqual({
      type: 'destination_storage_not_writable',
    });
  });

  test('rejects a transfer key it cannot parse with 400, and never asks the destination anything', async () => {
    const app = buildSourceApp(ADMIN_CALLER);
    const before = await snapshotDestination();
    const requestsBefore = destinationRequestCount;

    const response = await askPreflight(app, {
      transferKey: 'not-a-real-transfer-key',
    });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].code).toBe('transfer_key_invalid');
    // `TransferKey.parse` throws before any network call is made, so the destination
    // must not have heard from this request at all — not merely "unchanged", which a
    // successful preflight would also leave true.
    expect(destinationRequestCount).toBe(requestsBefore);
    expect(await snapshotDestination()).toEqual(before);
  });

  test('refuses a caller who never logged in with 403, and never asks the destination anything', async () => {
    const app = buildSourceApp(); // no req.user at all
    const before = await snapshotDestination();
    const requestsBefore = destinationRequestCount;

    const response = await askPreflight(app);

    // loginRequiredStrictly's own fallback for "no user at all", mounted under
    // `/_api/v3/...` exactly as production does: `req.baseUrl` matches the guest-API
    // branch, so this is a 403, not the redirect-to-`/login` behavior meant for
    // browser navigation.
    expect(response.status).toBe(403);
    expect(destinationRequestCount).toBe(requestsBefore);
    expect(await snapshotDestination()).toEqual(before);
  });

  test('redirects a logged-in non-admin caller away, and never asks the destination anything', async () => {
    const app = buildSourceApp(NON_ADMIN_CALLER);
    const before = await snapshotDestination();
    const requestsBefore = destinationRequestCount;

    const response = await askPreflight(app);

    // adminRequired's own fallback for "logged in, not an admin". Asserting this
    // exact target (rather than "not 200") is what makes removing *just*
    // adminRequired from the chain observable: loginRequiredStrictly alone lets this
    // caller through to the handler, which would answer 200.
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
    expect(destinationRequestCount).toBe(requestsBefore);
    expect(await snapshotDestination()).toEqual(before);
  });

  test('rejects a suspended administrator on login status before adminRequired ever runs, and never asks the destination anything', async () => {
    // Requirement-adjacent to the admin gate, but a different failure mode: this
    // caller passes adminRequired's own `.admin` check, so only loginRequiredStrictly
    // rejects them. Asserting this exact target is what makes removing *just*
    // loginRequiredStrictly from the chain observable: adminRequired alone would wave
    // this caller through to the handler (it never looks at `.status`), which would
    // answer 200 — the same false-pass NON_ADMIN_CALLER above cannot catch, since
    // adminRequired rejects that caller on its own.
    const app = buildSourceApp(SUSPENDED_ADMIN_CALLER);
    const before = await snapshotDestination();
    const requestsBefore = destinationRequestCount;

    const response = await askPreflight(app);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/login/error/suspended');
    expect(destinationRequestCount).toBe(requestsBefore);
    expect(await snapshotDestination()).toEqual(before);
  });
});
