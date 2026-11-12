/**
 * The admin zip import has to respect the same claim as the G2G receive route
 * (requirement 2.7).
 *
 * It has a gate of its own — it refuses to run unless GROWI is in maintenance mode — but
 * that gate answers a different question. It asks whether the wiki is closed to ordinary
 * users, not whether an import is already running, and being closed is the normal state
 * around an import (importing `configs` leaves maintenance mode on afterwards). So during
 * exactly the window that must be protected, this route waves an operator's zip straight
 * through into the middle of the other import. Both entry points therefore share one
 * claim.
 *
 * The second case below covers the other way that claim can go wrong: being taken and
 * never given back, which refuses every later import — admin and G2G alike — for the life
 * of the process.
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import type AppService from '~/server/service/app';
import { configManager } from '~/server/service/config-manager';
import { GrowiBridgeService } from '~/server/service/growi-bridge';
import {
  getImportService,
  initializeImportService,
} from '~/server/service/import';
import type { ImportService } from '~/server/service/import/import';
import type { SocketIoService } from '~/server/service/socket-io';

import route from './import';
import addCustomFunctionToResponse from './response';

/**
 * Turned on for the second case only, where it reproduces `add-activity` failing: the
 * real middleware catches its own errors and calls `next()` without ever having set
 * `res.locals.activity`, leaving the route to read a property off `undefined`.
 */
let suppressActivityContext = false;

vi.mock('~/server/middlewares/add-activity', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('~/server/middlewares/add-activity')>();

  return {
    generateAddActivityMiddleware: () => {
      const addActivity = actual.generateAddActivityMiddleware();
      return (req: Request, res: Response, next: NextFunction): void => {
        if (suppressActivityContext) {
          next();
          return;
        }
        addActivity(req, res, next);
      };
    },
  };
});

const UPLOADED_ZIP = 'admin-import-concurrency.zip';

const ADMIN_USER = {
  _id: '0123456789abcdef01470001',
  admin: true,
  status: 2, // UserStatus.STATUS_ACTIVE
} as const;

/**
 * Polls until the import claim can be taken again. Polled rather than read once because
 * the route answers before the import it started has finished, and the claim is only given
 * back when that import ends.
 */
async function waitUntilImportJobIsFree(
  importService: ImportService,
  maxWaitMs = 10_000,
): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const lease = importService.acquireImportJob();
    if (lease != null) {
      lease.release();
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

describe('admin import route POST / — refusing a concurrent import', () => {
  let app: express.Application;
  let importService: ImportService;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'admin-import-concurrency-'),
    );
    await fs.mkdir(path.join(tmpDir, 'imports'), { recursive: true });
    // The route resolves the uploaded archive before it responds. Its contents do not
    // matter here — the import fails afterwards, out of band, which is fine.
    await fs.writeFile(path.join(tmpDir, 'imports', UPLOADED_ZIP), '');

    const appService = mock<AppService>();
    appService.isMaintenanceMode.mockReturnValue(true);

    // The route reports the (expected) import failure over the admin socket after it has
    // responded; without a socket to report to, that turns into an unhandled rejection.
    const socketIoService = mock<SocketIoService>();
    socketIoService.getAdminSocket.mockReturnValue(
      mock<ReturnType<SocketIoService['getAdminSocket']>>(),
    );

    const crowi = mock<Crowi>({
      tmpDir,
      events: {
        admin: new EventEmitter(),
        // crowi.events.activity is typed `any`; the route only emits on it.
        activity: new EventEmitter(),
      },
      appService,
      socketIoService,
    });
    crowi.growiBridgeService = new GrowiBridgeService(crowi);
    // The route reads app:isV5Compatible from it.
    await configManager.loadConfigs();
    crowi.configManager = configManager;
    initializeImportService(crowi);
    importService = getImportService();

    addCustomFunctionToResponse(express);

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as express.Request & { user: unknown }).user = ADMIN_USER;
      next();
    });
    app.use(route(crowi));
  }, 120_000);

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('refuses while another import holds the claim, and accepts once it is released', async () => {
    const heldElsewhere = importService.acquireImportJob();
    expect(heldElsewhere).not.toBeNull();

    const refused = await request(app)
      .post('/')
      .send({
        fileName: UPLOADED_ZIP,
        collections: ['tags'],
        options: [{ collectionName: 'tags', mode: 'insert' }],
      });

    expect(refused.status).toBe(409);
    expect(refused.body.errors[0].code).toBe('import_already_in_progress');

    // Maintenance mode is on throughout, so the refusal above came from the shared claim
    // and not from this route's own gate.
    heldElsewhere?.release();

    const accepted = await request(app)
      .post('/')
      .send({
        fileName: UPLOADED_ZIP,
        collections: ['tags'],
        options: [{ collectionName: 'tags', mode: 'insert' }],
      });

    // The import itself fails right after this response — there is no such zip — but the
    // route answered before starting, which is the point: the claim was available.
    expect(accepted.status).toBe(200);
  });

  test('gives the claim back when the request carries no activity context', async () => {
    // The import the case above started is still finishing; it releases the claim when it
    // does, and this case needs to begin from a free one.
    expect(await waitUntilImportJobIsFree(importService)).toBe(true);

    suppressActivityContext = true;
    try {
      // `deadline` because the failure mode here is silence, not an error status: reading
      // the missing activity context threw between claiming and the `try` that releases
      // the claim, and Express 4 does not catch an async handler's rejection, so the
      // request simply never came back.
      const accepted = await request(app)
        .post('/')
        .send({
          fileName: UPLOADED_ZIP,
          collections: ['tags'],
          options: [{ collectionName: 'tags', mode: 'insert' }],
        })
        .timeout({ deadline: 3000 });

      expect(accepted.status).toBe(200);
    } finally {
      suppressActivityContext = false;
    }

    // The regression itself: with the claim never released, every later import — this
    // route and the G2G receive route alike — is refused for the life of the process.
    expect(await waitUntilImportJobIsFree(importService)).toBe(true);
  });
});
