import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import { recordArchiveOperation } from '~/features/opentelemetry/server';
import type Crowi from '~/server/crowi';

import { setup } from './admin';

const { getFileMock } = vi.hoisted(() => ({ getFileMock: vi.fn() }));
vi.mock('~/server/service/export', () => ({
  exportService: { getFile: getFileMock },
}));
vi.mock('~/features/opentelemetry/server', () => ({
  recordArchiveOperation: vi.fn(),
}));

const EXISTING_FILE = fileURLToPath(import.meta.url);

describe('GET /download/:fileName — archive download metrics', () => {
  let app: express.Application;
  let createActivityMock: ReturnType<typeof vi.fn>;
  const recordMock = vi.mocked(recordArchiveOperation);

  beforeEach(() => {
    vi.clearAllMocks();

    createActivityMock = vi.fn();
    const crowi = mock<Crowi>({
      activityService: mock<Crowi['activityService']>({
        createActivity: createActivityMock,
      }),
    });

    const actions = setup(crowi, express());
    app = express();
    app.get(
      '/download/:fileName',
      actions.export.api.validators.export.download(),
      actions.export.download,
    );
  });

  it('records download/success once when the file is found', async () => {
    getFileMock.mockReturnValue(EXISTING_FILE);

    const res = await request(app).get('/download/growi.zip');

    expect(res.status).toBe(200);
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock).toHaveBeenCalledWith('download', 'success');
  });

  it('records even when the audit-log activity creation throws', async () => {
    getFileMock.mockReturnValue(EXISTING_FILE);
    createActivityMock.mockImplementation(() => {
      throw new Error('audit log unavailable');
    });

    await request(app).get('/download/growi.zip');

    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock).toHaveBeenCalledWith('download', 'success');
  });

  it('does not record a request rejected by path validation', async () => {
    const res = await request(app).get('/download/..%2Fsecret.zip');

    expect(res.status).toBe(422);
    expect(getFileMock).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('does not record when the file lookup throws', async () => {
    getFileMock.mockImplementation(() => {
      throw new Error('file not found');
    });

    await request(app).get('/download/missing.zip');

    expect(recordMock).not.toHaveBeenCalled();
  });
});
