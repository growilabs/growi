import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('~/server/middlewares/apiv3-form-validator', () => {
  const { validationResult } = require('express-validator');
  return {
    apiV3FormValidator: (req: Request, res: Response, next: NextFunction) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        const validationErrors = errors.array().map((err: any) => ({
          message: `${err.param}: ${err.msg}`,
          code: 'validation_failed',
        }));
        return (res as any).apiv3Err(validationErrors, 400);
      }
      return next();
    },
  };
});

vi.mock('../../service/audit-log-bulk-export', async () => {
  const actual = await import('../../service/audit-log-bulk-export');
  return {
    ...actual,
    auditLogBulkExportService: {
      createOrResetExportJob: vi.fn(),
    },
  };
});

import type Crowi from '~/server/crowi';
import { auditLogBulkExportService } from '../../service/audit-log-bulk-export';

const routerMod = await import('./audit-log-bulk-export') as any;
const routerFactory = routerMod.default;

import * as ServiceModule from '../../service/audit-log-bulk-export';

function buildCrowi(): Crowi {
  const accessTokenParser =
    () =>
    (
      req: Request & { user?: { _id: string } },
      _res: Response,
      next: NextFunction,
    ) => {
      req.user = { _id: '6561a1a1a1a1a1a1a1a1a1a1' };
      next();
    };

  return { accessTokenParser } as unknown as Crowi;
}

function withApiV3Helpers(app: express.Express) {
  app.use((req, res, next) => {
    (res as any).apiv3 = (body: unknown, status = 200) =>
      res.status(status).json(body);

    (res as any).apiv3Err = (_err: unknown, status = 500, info?: unknown) => {
      let errors = Array.isArray(_err) ? _err : [_err];

      errors = errors.map((e: any) => {
        if (e && typeof e === 'object' && e.message && e.code) {
          return e;
        }
        return e;
      });

      return res.status(status).json({ errors, info });
    };

    next();
  });
}

function buildApp() {
  const app = express();
  app.use(express.json());
  withApiV3Helpers(app);
  const crowi = buildCrowi();
  const router = routerFactory(crowi);
  app.use('/_api/v3/audit-log-bulk-export', router);
  return app;
}

describe('POST /_api/v3/audit-log-bulk-export', () => {
  const createOrReset =
    auditLogBulkExportService.createOrResetExportJob as unknown as ReturnType<
      typeof vi.fn
    >;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 201 with jobId on success', async () => {
    createOrReset.mockResolvedValueOnce('job-123');

    const app = buildApp();
    const res = await request(app)
      .post('/_api/v3/audit-log-bulk-export')
      .send({
        filters: { actions: ['PAGE_VIEW'] },
        restartJob: false,
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ jobId: 'job-123' });

    expect(createOrReset).toHaveBeenCalledTimes(1);
    const [filters, format, userId, restartJob] = createOrReset.mock.calls[0];

    expect(filters).toEqual({ actions: ['PAGE_VIEW'] });
    expect(format).toBe('json');
    expect(userId).toBeDefined();
    expect(restartJob).toBe(false);
  });

  it('returns 409 with proper error code when DuplicateAuditLogBulkExportJobError is thrown', async () => {
    const DuplicateErrCtor =
      (ServiceModule as any).DuplicateAuditLogBulkExportJobError ?? (() => {});
    const err = Object.create(DuplicateErrCtor.prototype);
    err.message = 'Duplicate audit-log bulk export job is in progress';
    err.code = 'audit_log_bulk_export.duplicate_export_job_error';
    err.duplicateJob = { createdAt: new Date('2025-10-01T00:00:00Z') };

    createOrReset.mockRejectedValueOnce(err);

    const app = buildApp();
    const res = await request(app)
      .post('/_api/v3/audit-log-bulk-export')
      .send({
        filters: { actions: ['PAGE_VIEW'] },
      });

    expect(res.status).toBe(409);
    expect(res.body?.errors).toBeDefined();
    expect(res.body?.errors?.[0]?.code).toBe(
      'audit_log_bulk_export.duplicate_export_job_error',
    );
    expect(res.body?.errors?.[0]?.args?.duplicateJob?.createdAt).toBeDefined();
  });

  it('returns 500 with proper error code when unexpected error occurs', async () => {
    createOrReset.mockRejectedValueOnce(new Error('boom'));

    const app = buildApp();
    const res = await request(app)
      .post('/_api/v3/audit-log-bulk-export')
      .send({
        filters: { actions: ['PAGE_VIEW'] },
      });

    expect(res.status).toBe(500);
    expect(res.body?.errors).toBeDefined();
    expect(res.body?.errors?.[0]?.code).toBe(
      'audit_log_bulk_export.failed_to_export',
    );
  });

  describe('validation tests', () => {
    it('returns 400 when filters is missing', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/_api/v3/audit-log-bulk-export')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body?.errors).toBeDefined();
    });

    it('returns 400 when filters is not an object', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/_api/v3/audit-log-bulk-export')
        .send({
          filters: 'invalid',
        });

      expect(res.status).toBe(400);
      expect(res.body?.errors).toBeDefined();
    });

    it('returns 400 when users contains invalid ObjectId', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/_api/v3/audit-log-bulk-export')
        .send({
          filters: {
            users: ['invalid-objectid'],
          },
        });

      expect(res.status).toBe(400);
      expect(res.body?.errors).toBeDefined();
    });

    it('returns 400 when actions contains invalid action', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/_api/v3/audit-log-bulk-export')
        .send({
          filters: {
            actions: ['invalid-action'],
          },
        });

      expect(res.status).toBe(400);
      expect(res.body?.errors).toBeDefined();
    });

    it('returns 400 when dateFrom is not a valid ISO date', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/_api/v3/audit-log-bulk-export')
        .send({
          filters: {
            dateFrom: 'invalid-date',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body?.errors).toBeDefined();
    });

    it('returns 400 when format is invalid', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/_api/v3/audit-log-bulk-export')
        .send({
          filters: { actions: ['PAGE_VIEW'] },
          format: 'invalid-format',
        });

      expect(res.status).toBe(400);
      expect(res.body?.errors).toBeDefined();
    });

    it('returns 400 when restartJob is not boolean', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/_api/v3/audit-log-bulk-export')
        .send({
          filters: { actions: ['PAGE_VIEW'] },
          restartJob: 'not-boolean',
        });

      expect(res.status).toBe(400);
      expect(res.body?.errors).toBeDefined();
    });

    it('accepts valid request with all optional fields', async () => {
      createOrReset.mockResolvedValueOnce('job-456');

      const app = buildApp();
      const res = await request(app)
        .post('/_api/v3/audit-log-bulk-export')
        .send({
          filters: {
            users: ['6561a1a1a1a1a1a1a1a1a1a1'],
            actions: ['PAGE_VIEW', 'PAGE_CREATE'],
            dateFrom: '2023-01-01T00:00:00Z',
            dateTo: '2023-12-31T23:59:59Z',
          },
          format: 'json',
          restartJob: true,
        });

      expect(res.status).toBe(201);
      expect(res.body?.jobId).toBe('job-456');
    });
  });
});
