/**
 * One migration transfer, driven through both sides' real code paths in a single
 * process: the push route, the real pusher (which runs ExportService.export), and the
 * receive route (which runs ImportService.import). Those two services are shared with
 * the data-archive feature, so the observable contract is that the transfer counts only
 * as a transfer and never as an archive operation (requirements 1.9, 2.6).
 *
 * Only the network hop is replaced: the pusher's HTTP call is forwarded to the receive
 * route over supertest, so the archive travels exactly as it would between instances.
 *
 * Requires a real MongoDB (wired by vitest.workspace.mts integ setup).
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { buffer } from 'node:stream/consumers';
// biome-ignore lint/style/noRestrictedImports: the pusher posts the archive with raw axios, which is the object to intercept
import rawAxios from 'axios';
import express from 'express';
import type FormData from 'form-data';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import { ImportMode } from '~/models/admin/import-mode';
import type Crowi from '~/server/crowi';
import {
  setupIndependentModels,
  setupModelsDependentOnCrowi,
} from '~/server/crowi/setup-models';
import type UserEvent from '~/server/events/user';
import type AppService from '~/server/service/app';
import { configManager } from '~/server/service/config-manager';
import instanciateExportService from '~/server/service/export';
import {
  G2GTransferPusherService,
  G2GTransferReceiverService,
} from '~/server/service/g2g-transfer';
import { GrowiBridgeService } from '~/server/service/growi-bridge';
import { initializeImportService } from '~/server/service/import';
import type { SocketIoService } from '~/server/service/socket-io';

import { setup } from './g2g-transfer';
import addCustomFunctionToResponse from './response';

const { recordG2GTransfer, recordArchiveOperation } = vi.hoisted(() => ({
  recordG2GTransfer: vi.fn(),
  recordArchiveOperation: vi.fn(),
}));

vi.mock('~/features/opentelemetry/server', () => ({
  recordG2GTransfer,
  recordArchiveOperation,
}));

const ADMIN_USER = {
  _id: '0123456789abcdef014b0001',
  admin: true,
  status: 2, // UserStatus.STATUS_ACTIVE — what loginRequiredStrictly checks for
} as const;

describe('a migration transfer is not counted as an archive operation', () => {
  let app: express.Application;
  let tmpDir: string;
  let transferKeyString: string;
  let pusherService: G2GTransferPusherService;

  const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'g2g-no-double-count-'));
    await fs.mkdir(path.join(tmpDir, 'imports'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'downloads'), { recursive: true });

    const crowi = mock<Crowi>({
      tmpDir,
      events: {
        page: mock<EventEmitter>(),
        user: mock<UserEvent>(),
        admin: new EventEmitter(),
      },
      appService: mock<AppService>(),
      socketIoService: mock<SocketIoService>({
        getAdminSocket: vi.fn(),
      }),
    });
    crowi.growiBridgeService = new GrowiBridgeService(crowi);
    initializeImportService(crowi);
    instanciateExportService(crowi);

    await setupModelsDependentOnCrowi(crowi);
    await setupIndependentModels();

    const receiverService = new G2GTransferReceiverService(crowi);
    crowi.g2gTransferReceiverService = receiverService;
    pusherService = new G2GTransferPusherService(crowi);
    crowi.g2gTransferPusherService = pusherService;

    await configManager.loadConfigs();
    addCustomFunctionToResponse(express);

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      // The push route needs a logged-in admin; the receive route ignores the user.
      (req as express.Request & { user: unknown }).user = ADMIN_USER;
      next();
    });
    app.use(setup(crowi));

    transferKeyString = await receiverService.createTransferKey(
      'http://g2g-no-double-count.example.com',
    );
  }, 120_000);

  beforeEach(() => {
    recordG2GTransfer.mockClear();
    recordArchiveOperation.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('records only the two transfer outcomes while the real export and import run', async () => {
    // The destination's answer and attachment listing are outside what is verified here.
    vi.spyOn(pusherService, 'askGROWIInfo').mockResolvedValue(
      mock<Awaited<ReturnType<G2GTransferPusherService['askGROWIInfo']>>>(),
    );
    vi.spyOn(pusherService, 'getTransferability').mockResolvedValue({
      canTransfer: true,
    });
    vi.spyOn(pusherService, 'transferAttachments').mockResolvedValue();

    // Hand the archive the pusher would POST to the receive route, in-process.
    vi.spyOn(rawAxios, 'post').mockImplementation(
      async (_url, form: FormData, config) => {
        // form-data is a legacy stream, so it has to be piped to start flowing.
        const body = await buffer(form.pipe(new PassThrough()));
        const response = await request(app)
          .post('/')
          .set(
            Object.fromEntries(
              Object.entries(config?.headers ?? {}).map(([k, v]) => [
                k,
                String(v),
              ]),
            ),
          )
          .send(body);
        return { data: response.body, status: response.status };
      },
    );

    const response = await request(app)
      .post('/transfer')
      .send({
        transferKey: transferKeyString,
        // An empty collection: the import has nothing to collide with in the shared DB.
        collections: ['tags'],
        optionsMap: { tags: { mode: ImportMode.insert } },
      });
    expect(response.status).toBe(200);

    // Both sides report once the real export, upload and import have completed.
    await vi.waitFor(() => expect(recordG2GTransfer).toHaveBeenCalledTimes(2), {
      timeout: 15_000,
    });
    await flushPromises();

    expect(recordG2GTransfer.mock.calls).toEqual(
      expect.arrayContaining([
        ['source', 'success'],
        ['destination', 'success'],
      ]),
    );
    expect(recordArchiveOperation).not.toHaveBeenCalled();
  });
});
