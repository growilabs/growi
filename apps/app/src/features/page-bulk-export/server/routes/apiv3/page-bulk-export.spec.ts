import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

import { pageBulkExportService } from '../../service/page-bulk-export';
import { setup } from './page-bulk-export';

vi.mock('~/server/middlewares/login-required', () => ({
  default: () => (_req: Request, _res: Response, next: NextFunction) => {
    next();
  },
}));

vi.mock('../../service/page-bulk-export', () => ({
  DuplicateBulkExportJobError: class extends Error {},
  pageBulkExportService: { createOrResetBulkExportJob: vi.fn() },
}));

const buildApp = (): express.Express => {
  const crowi = mock<Crowi>({
    accessTokenParser:
      () => (req: Request, _res: Response, next: NextFunction) => {
        Object.assign(req, { user: { _id: '6561a1a1a1a1a1a1a1a1a1a1' } });
        next();
      },
  });

  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    Object.assign(res, {
      apiv3: (body: unknown, status = 200) => res.status(status).json(body),
      apiv3Err: (err: unknown, status = 500) =>
        res.status(status).json({ errors: [err] }),
    } satisfies Partial<ApiV3Response>);
    next();
  });
  app.use('/', setup(crowi));
  return app;
};

describe('POST /page-bulk-export format validation', () => {
  const createOrResetBulkExportJob = vi.mocked(
    pageBulkExportService.createOrResetBulkExportJob,
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    'md',
    'pdf',
  ])('starts a job for the supported format %s', async (format) => {
    const response = await request(buildApp())
      .post('/')
      .send({ path: '/page', format });

    expect(response.status).toBe(204);
    expect(createOrResetBulkExportJob).toHaveBeenCalledTimes(1);
    expect(createOrResetBulkExportJob.mock.calls[0][1]).toBe(format);
  });

  it.each([
    ['an unsupported format', { format: 'docx' }],
    ['a path traversal string', { format: '/../../../../tmp/x' }],
    ['an empty string', { format: '' }],
    ['a missing format', {}],
    ['a number', { format: 1 }],
    ['an array whose first element is supported', { format: ['md', '/../x'] }],
    ['an array of supported formats', { format: ['md', 'pdf'] }],
    ['an object', { format: { md: 'md' } }],
  ])('rejects %s with 400 and starts no job', async (_label, body) => {
    const response = await request(buildApp())
      .post('/')
      .send({ path: '/page', ...body });

    expect(response.status).toBe(400);
    expect(createOrResetBulkExportJob).not.toHaveBeenCalled();
  });
});
