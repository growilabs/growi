/**
 * Tests for attachment-reextract route.
 *
 * Tests cover:
 *  1. 404 when attachment not found
 *  2. 403 when attachment has no parent page (orphan)
 *  3. 403 when parent page is not found in DB
 *  4. 403 when user is not admin and not page editor
 *  5. 200 with outcome when admin calls it
 *  6. 200 with outcome when page editor (in grantedUsers) calls it
 *  7. 200 with outcome for public page (any logged-in user)
 *  8. 503 when feature disabled (require-search-attachments-enabled middleware)
 */

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted stubs — must use vi.hoisted() so they exist before vi.mock factories
// ---------------------------------------------------------------------------

const { mockAttachmentFindById, mockPageFindById } = vi.hoisted(() => ({
  mockAttachmentFindById: vi.fn(),
  mockPageFindById: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig: vi.fn() },
}));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('~/server/models/attachment', () => ({
  Attachment: { findById: mockAttachmentFindById },
}));

vi.mock('mongoose', () => ({
  default: {
    model: vi.fn().mockImplementation(() => ({
      findById: mockPageFindById,
    })),
  },
}));

// Mock access-token-parser — no-op: call next() immediately
vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser:
    () => (_req: Request, _res: Response, next: NextFunction) =>
      next(),
}));

// Mock login-required — no-op: user is already on req from test setup
vi.mock('~/server/middlewares/login-required', () => ({
  default: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { configManager } from '~/server/service/config-manager';

import { createAttachmentReextractRouter } from './attachment-reextract';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockRes = {
  apiv3: ReturnType<typeof vi.fn>;
  apiv3Err: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
};

function buildRes(): MockRes {
  return {
    apiv3: vi.fn().mockReturnThis(),
    apiv3Err: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

type MockIndexer = {
  reindex: ReturnType<typeof vi.fn>;
  onAttach: ReturnType<typeof vi.fn>;
  onDetach: ReturnType<typeof vi.fn>;
};

function buildIndexer(): MockIndexer {
  return {
    reindex: vi.fn(),
    onAttach: vi.fn(),
    onDetach: vi.fn(),
  };
}

/**
 * Directly invokes the async route handler extracted from the router's stack,
 * bypassing all middleware (which are mocked to no-op anyway).
 *
 * Express stores each `router.post(path, ...handlers)` call as a Route in the
 * router stack. Each Route holds its own handler stack. We pick the last
 * handler (the async business-logic function) and call it directly.
 */
async function invokeRouteHandler(
  router: ReturnType<typeof createAttachmentReextractRouter>,
  req: Partial<Request>,
  res: MockRes,
): Promise<void> {
  type RouterStack = Array<{
    route?: {
      stack: Array<{
        handle: (req: Request, res: Response, next: NextFunction) => void;
      }>;
    };
  }>;

  const stack = (router as unknown as { stack: RouterStack }).stack;
  const routeLayer = stack.find((l) => l.route != null);
  if (routeLayer?.route == null) throw new Error('No route found in router');

  const handlers = routeLayer.route.stack;
  const asyncHandler = handlers[handlers.length - 1].handle;

  await asyncHandler(
    req as Request,
    res as unknown as Response,
    (err?: unknown) => {
      if (err != null) throw err;
    },
  );
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('createAttachmentReextractRouter', () => {
  let mockGetConfig: ReturnType<typeof vi.fn>;
  let isSearchServiceConfigured: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetConfig = vi.mocked(configManager.getConfig);
    mockGetConfig.mockReset();
    mockAttachmentFindById.mockReset();
    mockPageFindById.mockReset();
    isSearchServiceConfigured = vi.fn().mockReturnValue(true);

    // Default: feature enabled
    mockGetConfig.mockImplementation((key: string) => {
      if (key === 'app:attachmentFullTextSearch:extractorUri')
        return 'http://extractor.example.com';
      if (key === 'app:attachmentFullTextSearch:extractorToken')
        return 'some-token';
      return undefined;
    });
  });

  it('1. returns 404 when attachment not found', async () => {
    mockAttachmentFindById.mockResolvedValue(null);

    const indexer = buildIndexer();
    const router = createAttachmentReextractRouter(
      {} as never,
      indexer as never,
      isSearchServiceConfigured,
    );
    const req = {
      params: { id: 'nonexistent-id' },
      user: { _id: 'user-1', admin: false },
    };
    const res = buildRes();

    await invokeRouteHandler(router, req as never, res);

    expect(res.apiv3Err).toHaveBeenCalledOnce();
    const [err, statusCode] = res.apiv3Err.mock.calls[0];
    expect(statusCode).toBe(404);
    expect(err.code).toBe('attachment_not_found');
  });

  it('2. returns 403 when attachment has no parent page (orphan)', async () => {
    mockAttachmentFindById.mockResolvedValue({ _id: 'attach-1', page: null });

    const indexer = buildIndexer();
    const router = createAttachmentReextractRouter(
      {} as never,
      indexer as never,
      isSearchServiceConfigured,
    );
    const req = {
      params: { id: 'attach-1' },
      user: { _id: 'user-1', admin: false },
    };
    const res = buildRes();

    await invokeRouteHandler(router, req as never, res);

    expect(res.apiv3Err).toHaveBeenCalledOnce();
    const [err, statusCode] = res.apiv3Err.mock.calls[0];
    expect(statusCode).toBe(403);
    expect(err.code).toBe('forbidden');
  });

  it('3. returns 403 when parent page is not found in DB', async () => {
    mockAttachmentFindById.mockResolvedValue({
      _id: 'attach-1',
      page: { toString: () => 'page-id-1' },
    });
    mockPageFindById.mockResolvedValue(null);

    const indexer = buildIndexer();
    const router = createAttachmentReextractRouter(
      {} as never,
      indexer as never,
      isSearchServiceConfigured,
    );
    const req = {
      params: { id: 'attach-1' },
      user: { _id: 'user-1', admin: false },
    };
    const res = buildRes();

    await invokeRouteHandler(router, req as never, res);

    expect(res.apiv3Err).toHaveBeenCalledOnce();
    const [err, statusCode] = res.apiv3Err.mock.calls[0];
    expect(statusCode).toBe(403);
    expect(err.code).toBe('forbidden');
  });

  it('4. returns 403 when user is not admin and not in page grantedUsers (GRANT_OWNER)', async () => {
    mockAttachmentFindById.mockResolvedValue({
      _id: 'attach-1',
      page: { toString: () => 'page-id-1' },
    });
    mockPageFindById.mockResolvedValue({
      _id: 'page-id-1',
      grant: 4, // GRANT_OWNER
      grantedUsers: [{ _id: 'other-user' }],
    });

    const indexer = buildIndexer();
    const router = createAttachmentReextractRouter(
      {} as never,
      indexer as never,
      isSearchServiceConfigured,
    );
    const req = {
      params: { id: 'attach-1' },
      user: { _id: 'user-1', admin: false },
    };
    const res = buildRes();

    await invokeRouteHandler(router, req as never, res);

    expect(res.apiv3Err).toHaveBeenCalledOnce();
    const [err, statusCode] = res.apiv3Err.mock.calls[0];
    expect(statusCode).toBe(403);
    expect(err.code).toBe('forbidden');
    expect(indexer.reindex).not.toHaveBeenCalled();
  });

  it('5. returns 200 with outcome when admin calls it (even if not in grantedUsers)', async () => {
    mockAttachmentFindById.mockResolvedValue({
      _id: 'attach-1',
      page: { toString: () => 'page-id-1' },
    });
    mockPageFindById.mockResolvedValue({
      _id: 'page-id-1',
      grant: 4, // GRANT_OWNER — admin is not in grantedUsers
      grantedUsers: [{ _id: 'other-user' }],
    });

    const indexer = buildIndexer();
    indexer.reindex.mockResolvedValue({
      ok: true,
      outcome: { kind: 'success', pages: [] },
    });

    const router = createAttachmentReextractRouter(
      {} as never,
      indexer as never,
      isSearchServiceConfigured,
    );
    const req = {
      params: { id: 'attach-1' },
      user: { _id: 'admin-user', admin: true },
    };
    const res = buildRes();

    await invokeRouteHandler(router, req as never, res);

    expect(indexer.reindex).toHaveBeenCalledWith('attach-1');
    expect(res.apiv3).toHaveBeenCalledOnce();
    const [body] = res.apiv3.mock.calls[0];
    expect(body).toHaveProperty('outcome');
    expect(body.outcome.kind).toBe('success');
  });

  it('6. returns 200 with outcome when page editor (in grantedUsers) calls it', async () => {
    mockAttachmentFindById.mockResolvedValue({
      _id: 'attach-1',
      page: { toString: () => 'page-id-1' },
    });
    mockPageFindById.mockResolvedValue({
      _id: 'page-id-1',
      grant: 4, // GRANT_OWNER — caller IS in grantedUsers
      grantedUsers: [{ _id: 'user-editor' }],
    });

    const indexer = buildIndexer();
    indexer.reindex.mockResolvedValue({
      ok: true,
      outcome: { kind: 'unsupported' },
    });

    const router = createAttachmentReextractRouter(
      {} as never,
      indexer as never,
      isSearchServiceConfigured,
    );
    const req = {
      params: { id: 'attach-1' },
      user: { _id: 'user-editor', admin: false },
    };
    const res = buildRes();

    await invokeRouteHandler(router, req as never, res);

    expect(indexer.reindex).toHaveBeenCalledWith('attach-1');
    expect(res.apiv3).toHaveBeenCalledOnce();
    const [body] = res.apiv3.mock.calls[0];
    expect(body.outcome.kind).toBe('unsupported');
  });

  it('7. returns 200 for any logged-in user when page grant is GRANT_PUBLIC (1)', async () => {
    mockAttachmentFindById.mockResolvedValue({
      _id: 'attach-public',
      page: { toString: () => 'page-pub' },
    });
    mockPageFindById.mockResolvedValue({
      _id: 'page-pub',
      grant: 1, // GRANT_PUBLIC
      grantedUsers: [],
    });

    const indexer = buildIndexer();
    indexer.reindex.mockResolvedValue({
      ok: true,
      outcome: { kind: 'success', pages: [] },
    });

    const router = createAttachmentReextractRouter(
      {} as never,
      indexer as never,
      isSearchServiceConfigured,
    );
    const req = {
      params: { id: 'attach-public' },
      user: { _id: 'any-user', admin: false },
    };
    const res = buildRes();

    await invokeRouteHandler(router, req as never, res);

    expect(indexer.reindex).toHaveBeenCalledWith('attach-public');
    expect(res.apiv3).toHaveBeenCalledOnce();
  });

  it('8. returns 503 when feature is disabled (requireSearchAttachmentsEnabled middleware blocks)', async () => {
    // Test the middleware in isolation — it is part of the route chain and
    // returns 503 when the feature is not configured.
    mockGetConfig.mockImplementation((key: string) => {
      if (key === 'app:attachmentFullTextSearch:extractorUri') return '';
      if (key === 'app:attachmentFullTextSearch:extractorToken') return '';
      return undefined;
    });
    const disabledConfigured = vi.fn().mockReturnValue(false);

    const { createRequireSearchAttachmentsEnabled } = await import(
      '../../middlewares/require-search-attachments-enabled'
    );

    const middleware =
      createRequireSearchAttachmentsEnabled(disabledConfigured);

    const req = {} as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        errors: expect.arrayContaining([
          expect.objectContaining({ code: 'feature_disabled' }),
        ]),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});
