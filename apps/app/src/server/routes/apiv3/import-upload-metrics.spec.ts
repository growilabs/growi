import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import { recordArchiveOperation } from '~/features/opentelemetry/server';
import type Crowi from '~/server/crowi';
import { getImportService } from '~/server/service/import';
import type { ImportService } from '~/server/service/import/import';
import type { ZipFileStat } from '~/server/service/interfaces/export';

import importRoute from './import';
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

describe('POST /import/upload — archive upload metrics', () => {
  let app: express.Application;
  let baseDir: string;
  const parseZipFile = vi.fn();
  const validate = vi.fn();
  const recordMock = vi.mocked(recordArchiveOperation);

  beforeAll(async () => {
    baseDir = await mkdtemp(path.join(tmpdir(), 'import-upload-'));
  });

  afterAll(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();

    const importService = mock<ImportService>({
      baseDir,
      getFile: (fileName: string) => path.join(baseDir, fileName),
      validate,
    });
    vi.mocked(getImportService).mockReturnValue(importService);

    const crowi = mock<Crowi>({
      growiBridgeService: mock<Crowi['growiBridgeService']>({ parseZipFile }),
      events: mock<Crowi['events']>({
        activity: new EventEmitter(),
        admin: new EventEmitter(),
      }),
    });

    app = express();
    app.use(express.json());
    addCustomFunctionToResponse(express);
    app.use('/import', importRoute(crowi));
  });

  const upload = () =>
    request(app)
      .post('/import/upload')
      .attach('file', Buffer.from('zip'), 'growi.zip');

  it('records upload/success once when the uploaded archive passes validation', async () => {
    parseZipFile.mockResolvedValue(
      mock<ZipFileStat>({ meta: { version: '1.0.0' } }),
    );
    validate.mockReturnValue(undefined);

    const res = await upload();

    expect(res.status).toBe(200);
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock).toHaveBeenCalledWith('upload', 'success');
  });

  it('records upload/failure once when the archive cannot be parsed', async () => {
    parseZipFile.mockRejectedValue(new Error('broken zip'));

    const res = await upload();

    expect(res.status).toBe(500);
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock).toHaveBeenCalledWith('upload', 'failure');
  });

  it('records upload/failure once when the versions are not the same', async () => {
    parseZipFile.mockResolvedValue(
      mock<ZipFileStat>({ meta: { version: '0.0.1' } }),
    );
    validate.mockImplementation(() => {
      throw new Error('version mismatch');
    });

    const res = await upload();

    expect(res.status).toBe(500);
    expect(res.body.errors[0].code).toBe('versions-are-not-met');
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock).toHaveBeenCalledWith('upload', 'failure');
  });

  it('does not record a request without a file', async () => {
    const res = await request(app)
      .post('/import/upload')
      .field('note', 'no file');

    expect(res.status).toBe(400);
    expect(parseZipFile).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
  });
});
