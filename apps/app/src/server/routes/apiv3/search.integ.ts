import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import type SearchService from '~/server/service/search';

const mockActivityId = '507f1f77bcf86cd799439011';

const passthroughMiddleware = (
  _req: Request,
  _res: Response,
  next: NextFunction,
) => next();

const mockAddActivityMiddleware = (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  res.locals = res.locals || {};
  res.locals.activity = { _id: mockActivityId };
  next();
};

vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser: () => passthroughMiddleware,
}));

vi.mock('~/server/middlewares/login-required', () => ({
  default: () => passthroughMiddleware,
}));

vi.mock('~/server/middlewares/admin-required', () => ({
  default: () => passthroughMiddleware,
}));

vi.mock('../../middlewares/add-activity', () => ({
  generateAddActivityMiddleware: () => mockAddActivityMiddleware,
}));

const mockGetConfig = vi.hoisted(() => vi.fn());
vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig: mockGetConfig },
}));

vi.mock('~/features/auditlog-es-sync/server', () => ({
  AuditlogEsSyncStatus: { isUnsynced: vi.fn().mockResolvedValue(false) },
}));

describe('search.js /auditlog-indices routes', () => {
  let app: express.Application;
  let mockSearchService: SearchService;
  let crowi: Crowi;

  beforeEach(async () => {
    // search.js's router is module-scoped, so reset the module registry to
    // avoid accumulating duplicate route registrations across tests.
    vi.resetModules();
    vi.clearAllMocks();
    mockGetConfig.mockReturnValue(true); // app:auditLogEnabled = true by default

    mockSearchService = mock<SearchService>({
      isConfigured: true,
      isReachable: true,
      getAuditlogInfoForAdmin: vi
        .fn()
        .mockResolvedValue({ isNormalized: true, indices: [], aliases: [] }),
      normalizeAuditlogIndices: vi.fn().mockResolvedValue(undefined),
      rebuildAuditlogIndex: vi
        .fn()
        .mockResolvedValue({ totalCount: 0, count: 0 }),
    });

    crowi = mock<Crowi>({
      events: { activity: { emit: vi.fn() } },
      searchService: mockSearchService,
    });

    app = express();
    app.use(express.json());

    app.use((_req, res: ApiV3Response, next) => {
      res.apiv3 = (data: unknown) => res.json(data);
      res.apiv3Err = (error: unknown, statusCode?: number) => {
        const status = statusCode ?? (Array.isArray(error) ? 400 : 500);
        return res.status(status).json({ error: String(error) });
      };
      next();
    });

    const { setup } = await import('./search');
    const searchRouter = setup(crowi);
    app.use('/', searchRouter);
  });

  afterEach(() => {
    // Not vi.restoreAllMocks(): that would reset bare vi.fn() mocks to a no-op.
    vi.clearAllMocks();
  });

  describe('GET /auditlog-indices', () => {
    it('returns 403 when AUDIT_LOG_ENABLED is false, without touching searchService', async () => {
      mockGetConfig.mockReturnValue(false);

      const response = await request(app).get('/auditlog-indices');

      expect(response.status).toBe(403);
      expect(mockSearchService.getAuditlogInfoForAdmin).not.toHaveBeenCalled();
    });

    it('returns 200 when AUDIT_LOG_ENABLED is true', async () => {
      const response = await request(app).get('/auditlog-indices');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('info');
    });

    it('returns 503 when the search service is unreachable, without touching searchService', async () => {
      const unreachableSearchService = mock<SearchService>({
        isConfigured: true,
        isReachable: false,
        getAuditlogInfoForAdmin: vi.fn(),
      });
      crowi.searchService = unreachableSearchService;

      const response = await request(app).get('/auditlog-indices');

      expect(response.status).toBe(503);
      expect(
        unreachableSearchService.getAuditlogInfoForAdmin,
      ).not.toHaveBeenCalled();
    });
  });

  describe('PUT /auditlog-indices', () => {
    it('returns 403 when AUDIT_LOG_ENABLED is false, without touching searchService', async () => {
      mockGetConfig.mockReturnValue(false);

      const response = await request(app)
        .put('/auditlog-indices')
        .send({ operation: 'rebuild' });

      expect(response.status).toBe(403);
      expect(mockSearchService.rebuildAuditlogIndex).not.toHaveBeenCalled();
    });

    it('accepts the request when AUDIT_LOG_ENABLED is true', async () => {
      const response = await request(app)
        .put('/auditlog-indices')
        .send({ operation: 'normalize' });

      expect(response.status).toBe(200);
      expect(mockSearchService.normalizeAuditlogIndices).toHaveBeenCalled();
    });
  });
});
