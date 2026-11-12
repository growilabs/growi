import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import { recordArchiveOperation } from '~/features/opentelemetry/server';
import type Crowi from '~/server/crowi';
import type { ZipFileStat } from '~/server/service/interfaces/export';

import { setup } from './export';
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
const { exportMock, loggerErrorMock } = vi.hoisted(() => ({
  exportMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));
vi.mock('~/utils/logger', () => ({
  default: () => ({
    error: loggerErrorMock,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock('~/server/service/export', () => ({
  exportService: { export: exportMock, getStatus: vi.fn() },
}));
vi.mock('~/features/opentelemetry/server', () => ({
  recordArchiveOperation: vi.fn(),
}));

const ZIP_FILE_STAT = mock<ZipFileStat>({ fileName: 'growi.zip' });

describe('POST /export — archive create metrics', () => {
  let app: express.Application;
  let activityEvent: EventEmitter;
  const recordMock = vi.mocked(recordArchiveOperation);

  beforeEach(() => {
    vi.clearAllMocks();

    activityEvent = new EventEmitter();
    const crowi = mock<Crowi>({
      events: mock<Crowi['events']>({
        activity: activityEvent,
        admin: new EventEmitter(),
      }),
    });

    // The collection-existence check reads the real connection; give it a fixed list.
    Object.defineProperty(mongoose.connection, 'db', {
      configurable: true,
      value: {
        listCollections: () => ({
          toArray: async () => [{ name: 'pages' }, { name: 'tags' }],
        }),
      },
    });

    app = express();
    app.use(express.json());
    addCustomFunctionToResponse(express);
    app.use('/export', setup(crowi));
  });

  afterEach(() => {
    Reflect.deleteProperty(mongoose.connection, 'db');
  });

  it('records create/success once when the export resolves with a zip file stat', async () => {
    exportMock.mockResolvedValue(ZIP_FILE_STAT);

    const res = await request(app)
      .post('/export')
      .send({ collections: ['pages'] });

    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(recordMock).toHaveBeenCalledTimes(1));
    expect(recordMock).toHaveBeenCalledWith('create', 'success');
  });

  it('records create/failure once when the export resolves with null', async () => {
    exportMock.mockResolvedValue(null);

    const res = await request(app)
      .post('/export')
      .send({ collections: ['pages'] });

    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(recordMock).toHaveBeenCalledTimes(1));
    expect(recordMock).toHaveBeenCalledWith('create', 'failure');
  });

  it('records create/failure once when the export rejects, and still responds 200', async () => {
    const failure = new Error('There is an exporting process running.');
    exportMock.mockRejectedValue(failure);

    const res = await request(app)
      .post('/export')
      .send({ collections: ['pages'] });

    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(recordMock).toHaveBeenCalledTimes(1));
    expect(recordMock).toHaveBeenCalledWith('create', 'failure');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ err: failure }),
      expect.any(String),
    );
  });

  it('responds before the export finishes and records only after it settles', async () => {
    let finishExport: (value: ZipFileStat | null) => void = () => {};
    exportMock.mockReturnValue(
      new Promise<ZipFileStat | null>((resolve) => {
        finishExport = resolve;
      }),
    );

    const res = await request(app)
      .post('/export')
      .send({ collections: ['pages'] });

    expect(res.status).toBe(200);
    expect(recordMock).not.toHaveBeenCalled();

    finishExport(ZIP_FILE_STAT);
    await vi.waitFor(() => expect(recordMock).toHaveBeenCalledTimes(1));
    expect(recordMock).toHaveBeenCalledWith('create', 'success');
  });

  it('does not record a request rejected by validation', async () => {
    const res = await request(app)
      .post('/export')
      .send({ collections: ['no-such-collection'] });

    expect(res.status).toBe(400);
    expect(exportMock).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
  });
});
