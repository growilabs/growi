/**
 * Route-level test for what the push route records about a migration transfer it starts
 * (requirements 2.1, 2.2, 2.5, 2.7, 2.8, 4.3). The pusher service and the metric
 * recorder are mocks: the observable contract here is which outcome the route hands to
 * the recorder, and when.
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
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
  type G2GTransferPusherService,
  G2GTransferReceiverService,
} from '~/server/service/g2g-transfer';
import { GrowiBridgeService } from '~/server/service/growi-bridge';
import { initializeImportService } from '~/server/service/import';

import { setup } from './g2g-transfer';
import addCustomFunctionToResponse from './response';

const { recordG2GTransfer } = vi.hoisted(() => ({
  recordG2GTransfer: vi.fn(),
}));

vi.mock('~/features/opentelemetry/server', () => ({ recordG2GTransfer }));

const ADMIN_USER = {
  _id: '0123456789abcdef01430003',
  admin: true,
  status: 2, // UserStatus.STATUS_ACTIVE — what loginRequiredStrictly checks for
} as const;

const REQUEST_BODY_BASE = {
  collections: ['users'],
  optionsMap: { users: { mode: ImportMode.insert } },
} as const;

describe('push route POST /transfer records the source-side outcome', () => {
  let app: express.Application;
  let pusherService: G2GTransferPusherService;
  let tmpDir: string;
  let transferKeyString: string;

  const postTransfer = () =>
    request(app)
      .post('/transfer')
      .send({ transferKey: transferKeyString, ...REQUEST_BODY_BASE });

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'g2g-source-metrics-'));

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

    const receiverService = new G2GTransferReceiverService(crowi);
    crowi.g2gTransferReceiverService = receiverService;
    pusherService = mock<G2GTransferPusherService>();
    crowi.g2gTransferPusherService = pusherService;

    await configManager.loadConfigs();
    addCustomFunctionToResponse(express);

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as express.Request & { user: unknown }).user = ADMIN_USER;
      next();
    });
    app.use(setup(crowi));

    transferKeyString = await receiverService.createTransferKey(
      'http://g2g-source-metrics.example.com',
    );
  }, 120_000);

  beforeEach(() => {
    recordG2GTransfer.mockClear();
    vi.mocked(pusherService.askGROWIInfo).mockReset();
    vi.mocked(pusherService.getTransferability).mockReset();
    vi.mocked(pusherService.startTransfer).mockReset();
    vi.mocked(pusherService.getTransferability).mockResolvedValue({
      canTransfer: true,
    });
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // startTransfer's settlement is observed by the route only through a promise chain, so
  // let it drain before asserting.
  const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

  test('records one success when the import completed', async () => {
    vi.mocked(pusherService.startTransfer).mockResolvedValue({
      importIncomplete: false,
    });

    const response = await postTransfer();
    await flushPromises();

    expect(response.status).toBe(200);
    expect(recordG2GTransfer.mock.calls).toEqual([['source', 'success']]);
  });

  test('records one failure when the import was left incomplete', async () => {
    vi.mocked(pusherService.startTransfer).mockResolvedValue({
      importIncomplete: true,
    });

    await postTransfer();
    await flushPromises();

    expect(recordG2GTransfer.mock.calls).toEqual([['source', 'failure']]);
  });

  test('records one failure when the transfer rejects, and the rejection stays handled', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      vi.mocked(pusherService.startTransfer).mockRejectedValue(
        new Error('transfer failed'),
      );

      const response = await postTransfer();
      await flushPromises();
      await flushPromises();

      expect(response.status).toBe(200);
      expect(recordG2GTransfer.mock.calls).toEqual([['source', 'failure']]);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  test('responds before the transfer settles and records only once it does', async () => {
    let settle: (value: { importIncomplete: boolean }) => void = () => {};
    vi.mocked(pusherService.startTransfer).mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );

    const response = await postTransfer();
    await flushPromises();

    expect(response.status).toBe(200);
    expect(recordG2GTransfer).not.toHaveBeenCalled();

    settle({ importIncomplete: false });
    await flushPromises();

    expect(recordG2GTransfer.mock.calls).toEqual([['source', 'success']]);
  });

  test('records nothing when the transfer is refused before it starts', async () => {
    vi.mocked(pusherService.getTransferability).mockResolvedValue({
      canTransfer: false,
      reason: 'incompatible',
    });

    const response = await postTransfer();
    await flushPromises();

    expect(response.status).not.toBe(200);
    expect(pusherService.startTransfer).not.toHaveBeenCalled();
    expect(recordG2GTransfer).not.toHaveBeenCalled();
  });

  test('records nothing when asking the destination for its GROWI info fails', async () => {
    vi.mocked(pusherService.askGROWIInfo).mockRejectedValue(
      new Error('unreachable'),
    );

    const response = await postTransfer();
    await flushPromises();

    expect(response.status).not.toBe(200);
    expect(pusherService.startTransfer).not.toHaveBeenCalled();
    expect(recordG2GTransfer).not.toHaveBeenCalled();
  });
});
