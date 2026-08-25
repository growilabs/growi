import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import { Types } from 'mongoose';
import request from 'supertest';
import { mockDeep } from 'vitest-mock-extended';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument } from '~/server/models/page';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
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

// Mock certify-shared-page as a static ESM import.
// vi.mock factories are hoisted, so they must be self-contained.
vi.mock('~/server/middlewares/certify-shared-page', () => ({
  setup: () => (req: TestRequest, _res: Response, next: NextFunction) => {
    const { shareLinkId, pageId } = req.query;
    if (shareLinkId && pageId) {
      req.isSharedPage = true;
    }
    next();
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

    // Add the real apiv3 response helpers (not a hand-rolled shim) so
    // assertions on the error body's shape — `errors[0].code` — actually
    // verify what production sends, rather than a stub's own guess at the
    // shape.
    const responseHelpers: { response: Record<string, unknown> } = {
      response: {},
    };
    addCustomFunctionToResponse(responseHelpers);
    app.use((_req, res: ApiV3Response, next) => {
      Object.assign(res, responseHelpers.response);
      next();
    });

    // Inject crowi instance
    app.use((req: TestRequest, _res, next) => {
      req.crowi = crowi;
      next();
    });

    // Mount the page router
    const { setup: setupPageRouter } = await import('./index');
    const pageRouter = setupPageRouter(crowi);
    app.use('/', pageRouter);
  });

  afterEach(() => {
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

    it('should return 404 when page is forbidden', async () => {
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

      // A requester without read access must not be able to tell a forbidden
      // page apart from a missing one. See
      // apps/app/.claude/rules/page-write-action-403-404.md.
      expect(response.status).toBe(404);
      expect(response.body.errors).toEqual([
        expect.objectContaining({ code: 'notfound_or_forbidden' }),
      ]);
      // The body must not carry `isForbidden`/`isNotFound` either — a caller
      // without read access must not learn which case this was from the
      // body any more than from the status. See
      // apps/app/.claude/rules/page-write-action-403-404.md.
      expect(response.body.errors[0].args).toBeUndefined();
    });

    it('should return 404 (same status) when page is not found and not forbidden', async () => {
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

      expect(response.status).toBe(404);
      expect(response.body.errors).toEqual([
        expect.objectContaining({ code: 'notfound_or_forbidden' }),
      ]);
      // The body must not carry `isForbidden`/`isNotFound` either — a caller
      // without read access must not learn which case this was from the
      // body any more than from the status. See
      // apps/app/.claude/rules/page-write-action-403-404.md.
      expect(response.body.errors[0].args).toBeUndefined();
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
