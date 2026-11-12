import { EventEmitter } from 'node:events';
import type { IUser } from '@growi/core';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import { type HydratedDocument, Types } from 'mongoose';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import { recordArchiveOperation } from '~/features/opentelemetry/server';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import type Crowi from '~/server/crowi';
import { getImportService } from '~/server/service/import';
import type {
  ImportJobLease,
  ImportService,
} from '~/server/service/import/import';
import type { ZipFileStat } from '~/server/service/interfaces/export';
import type { SocketIoService } from '~/server/service/socket-io';

import importRoute from './import';
import { executeImport } from './import-executor';
import addCustomFunctionToResponse from './response';

const passthroughMiddleware = (
  _req: Request,
  _res: Response,
  next: NextFunction,
) => next();

vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser: () => passthroughMiddleware,
}));
vi.mock('~/server/middlewares/login-required', () => ({
  default: () => passthroughMiddleware,
}));
vi.mock('~/server/middlewares/admin-required', () => ({
  default: () => passthroughMiddleware,
}));
vi.mock('~/server/middlewares/add-activity', () => ({
  generateAddActivityMiddleware:
    () => (_req: Request, res: Response, next: NextFunction) => {
      res.locals.activity = { _id: 'activity-id' };
      next();
    },
}));
vi.mock('~/server/service/import', () => ({
  getImportService: vi.fn(),
}));
vi.mock('~/features/opentelemetry/server', () => ({
  recordArchiveOperation: vi.fn(),
}));
vi.mock('./import-executor', () => ({
  executeImport: vi.fn(),
}));

describe('POST /import — archive import metrics', () => {
  let app: express.Application;
  let lease: ImportJobLease;
  let isMaintenanceMode: boolean;
  const parseZipFile = vi.fn();
  const recordMock = vi.mocked(recordArchiveOperation);
  const executeImportMock = vi.mocked(executeImport);

  beforeEach(() => {
    vi.clearAllMocks();
    isMaintenanceMode = true;

    lease = mock<ImportJobLease>();
    const importService = mock<ImportService>({
      getFile: (fileName: string) => `/imports/${fileName}`,
      acquireImportJob: () => lease,
    });
    vi.mocked(getImportService).mockReturnValue(importService);

    parseZipFile.mockResolvedValue(
      mock<ZipFileStat>({
        meta: { version: '1.0.0' },
        innerFileStats: [{ fileName: 'tags.json', collectionName: 'tags' }],
      }),
    );

    const crowi = mock<Crowi>({
      growiBridgeService: mock<Crowi['growiBridgeService']>({ parseZipFile }),
      socketIoService: mock<SocketIoService>({
        getAdminSocket: () =>
          mock<ReturnType<SocketIoService['getAdminSocket']>>(),
      }),
      configManager: mock<Crowi['configManager']>({
        getConfig: vi.fn().mockReturnValue(false),
      }),
      appService: mock<Crowi['appService']>({
        isMaintenanceMode: () => isMaintenanceMode,
      }),
      events: mock<Crowi['events']>({
        activity: new EventEmitter(),
        admin: new EventEmitter(),
      }),
    });

    app = express();
    app.use(express.json());
    app.use((req: CrowiRequest, _res: Response, next: NextFunction) => {
      req.user = mock<HydratedDocument<IUser>>({
        _id: new Types.ObjectId('0123456789abcdef01470001'),
      });
      next();
    });
    addCustomFunctionToResponse(express);
    app.use('/import', importRoute(crowi));
  });

  const postImport = () =>
    request(app)
      .post('/import')
      .send({
        fileName: 'growi.zip',
        collections: ['tags'],
        options: [{ collectionName: 'tags', mode: 'insert' }],
      });

  // The route answers before it imports, so the outcome is only known once the
  // background part has given the import claim back.
  const waitForBackgroundToFinish = () =>
    vi.waitFor(() => expect(lease.release).toHaveBeenCalled());

  it('records import/success once when the import succeeds', async () => {
    executeImportMock.mockResolvedValue('success');

    const res = await postImport();
    await waitForBackgroundToFinish();

    expect(res.status).toBe(200);
    expect(executeImportMock).toHaveBeenCalledTimes(1);
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock).toHaveBeenCalledWith('import', 'success');
  });

  it('records import/failure once when the import fails', async () => {
    executeImportMock.mockResolvedValue('failure');

    const res = await postImport();
    await waitForBackgroundToFinish();

    expect(res.status).toBe(200);
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock).toHaveBeenCalledWith('import', 'failure');
  });

  it('records import/failure once when the archive cannot be read before the import starts', async () => {
    parseZipFile.mockRejectedValue(new Error('broken zip'));

    const res = await postImport();
    await waitForBackgroundToFinish();

    expect(res.status).toBe(200);
    expect(executeImportMock).not.toHaveBeenCalled();
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock).toHaveBeenCalledWith('import', 'failure');
  });

  it('does not record a request refused before the response', async () => {
    isMaintenanceMode = false;

    const res = await postImport();

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('not_maintenance_mode');
    expect(recordMock).not.toHaveBeenCalled();
  });
});
