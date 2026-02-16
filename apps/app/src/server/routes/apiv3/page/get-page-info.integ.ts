import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import mockRequire from 'mock-require';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import * as findPageModule from '~/server/service/page/find-page-and-meta-data-by-viewer';

// Extend Request type for test
interface TestRequest extends Request {
  isSharedPage?: boolean;
  crowi?: Crowi;
}

// Passthrough middleware for testing - skips authentication
const passthroughMiddleware = (
  _req: Request,
  _res: Response,
  next: NextFunction,
) => next();

// Mock certify-shared-page middleware - sets isSharedPage when shareLinkId is present
const mockCertifySharedPage = (
  req: TestRequest,
  _res: Response,
  next: NextFunction,
) => {
  const { shareLinkId, pageId } = req.query;
  if (shareLinkId && pageId) {
    // In real implementation, this checks if shareLink exists and is valid
    req.isSharedPage = true;
  }
  next();
};

// Mock middlewares using vi.mock (hoisted to top)
vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser: () => passthroughMiddleware,
}));

vi.mock('~/server/middlewares/login-required', () => ({
  default: () => (req: TestRequest, _res: Response, next: NextFunction) => {
    // Allow access if isSharedPage is true (anonymous user accessing share link)
    if (req.isSharedPage) {
      return next();
    }
    // For non-shared pages, authentication would be required
    return next();
  },
}));

describe('GET /info', () => {
  let app: express.Application;
  let crowi: Crowi;

  // Valid ObjectId strings for testing
  const validPageId = '507f1f77bcf86cd799439011';
  const validShareLinkId = '507f1f77bcf86cd799439012';

  beforeAll(async () => {
    crowi = await getInstance();
  });

  beforeEach(async () => {
    // Mock certify-shared-page using mock-require
    mockRequire(
      '../../../middlewares/certify-shared-page',
      () => mockCertifySharedPage,
    );

    // Mock findPageAndMetaDataByViewer to return minimal successful response
    vi.spyOn(findPageModule, 'findPageAndMetaDataByViewer').mockResolvedValue({
      data: {
        _id: validPageId,
        path: '/test-page',
        revision: {
          _id: '507f1f77bcf86cd799439013',
          body: 'Test page content',
        },
      } as any,
      meta: {
        isNotFound: false,
        isForbidden: false,
      } as any,
    });

    // Setup express app
    app = express();
    app.use(express.json());

    // Mock apiv3 response methods
    app.use((_req, res, next) => {
      const apiRes = res as ApiV3Response;
      apiRes.apiv3 = (data: unknown) => res.json(data);
      apiRes.apiv3Err = (error: unknown, statusCode?: number) => {
        // Check if error is validation error (array of ErrorV3)
        const isValidationError =
          Array.isArray(error) &&
          error.some((e: unknown) => (e as any)?.code === 'validation_failed');
        const status = statusCode ?? (isValidationError ? 400 : 500);
        const errorMessage = (error as any)?.message || error;
        return res.status(status).json({ error: errorMessage });
      };
      next();
    });

    // Inject crowi instance
    app.use((req: TestRequest, _res, next) => {
      req.crowi = crowi;
      next();
    });

    // Import and mount the actual router
    const pageModule = await import('./index');
    const pageRouterFactory = (pageModule as any).default || pageModule;
    const pageRouter = pageRouterFactory(crowi);
    app.use('/', pageRouter);

    // Error handling middleware (must be after router)
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      const apiRes = res as ApiV3Response;
      const statusCode = (err as any).statusCode || (err as any).status || 500;
      return apiRes.apiv3Err(err, statusCode);
    });
  });

  afterEach(() => {
    // Clean up mocks
    mockRequire.stopAll();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('Normal page access', () => {
    it('should return 200 with page meta when pageId is valid', async () => {
      const response = await request(app)
        .get('/info')
        .query({ pageId: validPageId });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('isNotFound');
      expect(response.body).toHaveProperty('isForbidden');
      expect(response.body.isNotFound).toBe(false);
      expect(response.body.isForbidden).toBe(false);
    });

    it('should return 403 when page is forbidden', async () => {
      vi.spyOn(findPageModule, 'findPageAndMetaDataByViewer').mockResolvedValue(
        {
          data: null,
          meta: {
            isNotFound: true,
            isForbidden: true,
          } as any,
        },
      );

      const response = await request(app)
        .get('/info')
        .query({ pageId: validPageId });

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 200 when page is empty (not found but not forbidden)', async () => {
      vi.spyOn(findPageModule, 'findPageAndMetaDataByViewer').mockResolvedValue(
        {
          data: null,
          meta: {
            isNotFound: true,
            isForbidden: false,
            isEmpty: true,
          } as any,
        },
      );

      const response = await request(app)
        .get('/info')
        .query({ pageId: validPageId });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('isEmpty');
      expect(response.body.isEmpty).toBe(true);
    });
  });

  describe('Share link access', () => {
    it('should return 200 when accessing with both pageId and shareLinkId', async () => {
      const response = await request(app)
        .get('/info')
        .query({ pageId: validPageId, shareLinkId: validShareLinkId });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('isNotFound');
      expect(response.body).toHaveProperty('isForbidden');
    });

    it('should accept shareLinkId as optional parameter', async () => {
      const response = await request(app)
        .get('/info')
        .query({ pageId: validPageId, shareLinkId: validShareLinkId });

      expect(response.status).not.toBe(400); // Should not be validation error
    });
  });

  describe('Validation', () => {
    it('should reject invalid pageId format', async () => {
      const response = await request(app)
        .get('/info')
        .query({ pageId: 'invalid-id' });

      expect(response.status).toBe(400);
    });

    it('should reject invalid shareLinkId format', async () => {
      const response = await request(app)
        .get('/info')
        .query({ pageId: validPageId, shareLinkId: 'invalid-id' });

      expect(response.status).toBe(400);
    });

    it('should require pageId parameter', async () => {
      const response = await request(app).get('/info');

      expect(response.status).toBe(400);
    });

    it('should work with only pageId (shareLinkId is optional)', async () => {
      const response = await request(app)
        .get('/info')
        .query({ pageId: validPageId });

      expect(response.status).toBe(200);
    });
  });

  describe('Error handling', () => {
    it('should return 500 when service throws an error', async () => {
      vi.spyOn(findPageModule, 'findPageAndMetaDataByViewer').mockRejectedValue(
        new Error('Service error'),
      );

      const response = await request(app)
        .get('/info')
        .query({ pageId: validPageId });

      expect(response.status).toBe(500);
    });
  });
});
