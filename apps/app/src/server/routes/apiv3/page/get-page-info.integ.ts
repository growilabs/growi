import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import mockRequire from 'mock-require';
import { Types } from 'mongoose';
import request from 'supertest';
import { mockDeep } from 'vitest-mock-extended';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument } from '~/server/models/page';
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
    // Mock certify-shared-page middleware
    mockRequire(
      '../../../middlewares/certify-shared-page',
      () => mockCertifySharedPage,
    );

    // Mock findPageAndMetaDataByViewer with default successful response
    const mockSpy = vi.spyOn(findPageModule, 'findPageAndMetaDataByViewer');

    // Create type-safe mock PageDocument using vitest-mock-extended
    // Note: mockDeep makes all properties optional, but _id must be required
    const mockPageDoc = mockDeep<PageDocument>({
      _id: new Types.ObjectId(validPageId),
      path: '/test-page',
      status: 'published',
      isEmpty: false,
      grant: 1,
      descendantCount: 0,
      commentCount: 0,
    });

    type PageInfoExt = Exclude<
      Awaited<
        ReturnType<typeof findPageModule.findPageAndMetaDataByViewer>
      >['meta'],
      { isNotFound: true }
    >;

    mockSpy.mockResolvedValue({
      // mockDeep creates DeepMockProxy which conflicts with Required<{_id}>
      // so we acknowledge this limitation for Mongoose documents
      data: mockPageDoc as typeof mockPageDoc &
        Required<{ _id: Types.ObjectId }>,
      meta: {
        isNotFound: false,
        isV5Compatible: true,
        isEmpty: false,
        isMovable: false,
        isDeletable: false,
        isAbleToDeleteCompletely: false,
        isRevertible: false,
        bookmarkCount: 0,
      } satisfies PageInfoExt,
    });

    // Setup express app with middleware
    app = express();
    app.use(express.json());

    // Add apiv3 response helpers
    app.use((_req, res: ApiV3Response, next) => {
      res.apiv3 = (data: unknown) => res.json(data);
      res.apiv3Err = (error: unknown, statusCode?: number) => {
        // Validation errors come as arrays and should return 400
        const status = statusCode ?? (Array.isArray(error) ? 400 : 500);
        const errorMessage =
          typeof error === 'object' &&
          error !== null &&
          'message' in error &&
          typeof error.message === 'string'
            ? error.message
            : String(error);
        return res.status(status).json({ error: errorMessage });
      };
      next();
    });

    // Inject crowi instance
    app.use((req: TestRequest, _res, next) => {
      req.crowi = crowi;
      next();
    });

    // Mount the page router
    const pageModule = await import('./index');
    const factoryCandidate =
      'default' in pageModule ? pageModule.default : pageModule;
    if (typeof factoryCandidate !== 'function') {
      throw new Error('Module does not export a router factory function');
    }
    const pageRouter = factoryCandidate(crowi);
    app.use('/', pageRouter);
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
      expect(response.body).toHaveProperty('isV5Compatible');
      expect(response.body).toHaveProperty('isEmpty');
      expect(response.body).toHaveProperty('bookmarkCount');
      expect(response.body.isNotFound).toBe(false);
    });

    it('should return 403 when page is forbidden', async () => {
      const mockSpy = vi.spyOn(findPageModule, 'findPageAndMetaDataByViewer');
      mockSpy.mockResolvedValue({
        data: null,
        meta: {
          isNotFound: true,
          isForbidden: true,
        },
      } satisfies Awaited<
        ReturnType<typeof findPageModule.findPageAndMetaDataByViewer>
      >);

      const response = await request(app)
        .get('/info')
        .query({ pageId: validPageId });

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 200 when page is not found but not forbidden', async () => {
      const mockSpy = vi.spyOn(findPageModule, 'findPageAndMetaDataByViewer');
      mockSpy.mockResolvedValue({
        data: null,
        meta: {
          isNotFound: true,
          isForbidden: false,
        },
      } satisfies Awaited<
        ReturnType<typeof findPageModule.findPageAndMetaDataByViewer>
      >);

      const response = await request(app)
        .get('/info')
        .query({ pageId: validPageId });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('isNotFound');
      expect(response.body.isNotFound).toBe(true);
      expect(response.body.isForbidden).toBe(false);
    });
  });

  describe('Share link access', () => {
    it('should return 200 when accessing with both pageId and shareLinkId', async () => {
      const response = await request(app)
        .get('/info')
        .query({ pageId: validPageId, shareLinkId: validShareLinkId });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('isNotFound');
      expect(response.body).toHaveProperty('bookmarkCount');
      expect(response.body.isNotFound).toBe(false);
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
