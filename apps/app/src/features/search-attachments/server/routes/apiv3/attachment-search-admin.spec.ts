/**
 * Unit tests for attachment-search-admin: requiresReindex and the GET /failures handler.
 */

import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks (must be hoisted before dynamic imports)
// ---------------------------------------------------------------------------

// Mock configManager
vi.mock('~/server/service/config-manager', () => ({
  configManager: {
    getConfig: vi.fn(),
    updateConfigs: vi.fn(),
  },
}));

// Mock logger
vi.mock('~/utils/logger', () => ({
  default: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock ExtractionFailureLogService
const mockListRecent = vi.fn();
const mockTotalRecent = vi.fn();
vi.mock(
  '~/features/search-attachments/server/services/extraction-failure-log-service',
  () => ({
    ExtractionFailureLogService: vi.fn().mockImplementation(() => ({
      listRecent: mockListRecent,
      totalRecent: mockTotalRecent,
    })),
  }),
);

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import {
  attachmentSearchAdminFactory,
  computeRequiresReindex,
  invalidateRequiresReindexCache,
} from './attachment-search-admin';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockGetConfig = ReturnType<typeof vi.fn>;

function buildCrowiWithEsClient(esClient: unknown) {
  return {
    searchService: {
      fullTextSearchDelegator: { client: esClient },
    },
    attachmentIndexOperations: { aliasName: 'tenant-a-attachments-alias' },
  };
}

function buildEsClientWithCardinality(cardinalityValue: number) {
  return {
    search: vi.fn().mockResolvedValue({
      aggregations: {
        unique_attachments: { value: cardinalityValue },
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('attachment-search-admin', () => {
  let mockGetConfig: MockGetConfig;

  beforeEach(() => {
    mockGetConfig = vi.mocked(configManager.getConfig);
    mockGetConfig.mockReset();
    vi.mocked(configManager.updateConfigs).mockReset();

    // Invalidate cache before each test so tests are independent
    invalidateRequiresReindexCache();
  });

  // -------------------------------------------------------------------------
  // requiresReindex
  // -------------------------------------------------------------------------

  describe('computeRequiresReindex', () => {
    let countAttachments: MockInstance<typeof prisma.attachments.count>;

    beforeEach(() => {
      countAttachments = vi.spyOn(prisma.attachments, 'count');
    });

    afterEach(() => {
      countAttachments.mockRestore();
    });

    it('returns true when mongoCount > esCount', async () => {
      countAttachments.mockResolvedValue(10);

      const esClient = buildEsClientWithCardinality(5);
      const crowi = buildCrowiWithEsClient(esClient);

      const result = await computeRequiresReindex(crowi as never, true);

      expect(result).toBe(true);
      expect(esClient.search).toHaveBeenCalledWith(
        expect.objectContaining({
          index: 'tenant-a-attachments-alias',
        }),
      );
    });

    it('returns true when the attachment index does not exist yet, so the admin is prompted to rebuild', async () => {
      countAttachments.mockResolvedValue(10);
      const esClient = {
        search: vi.fn().mockRejectedValue(
          Object.assign(new Error('index_not_found_exception'), {
            meta: {
              statusCode: 404,
              body: { error: { type: 'index_not_found_exception' } },
            },
          }),
        ),
      };

      const result = await computeRequiresReindex(
        buildCrowiWithEsClient(esClient) as never,
        true,
      );

      expect(result).toBe(true);
    });

    it('returns false when the count fails for another reason', async () => {
      countAttachments.mockResolvedValue(10);
      const esClient = {
        search: vi.fn().mockRejectedValue(new Error('ES is down')),
      };

      const result = await computeRequiresReindex(
        buildCrowiWithEsClient(esClient) as never,
        true,
      );

      expect(result).toBe(false);
    });

    it('does not count attachments without a page, which are never indexed', async () => {
      // 10 attachments, 4 of them without a page
      countAttachments.mockImplementation((async (args?: {
        where?: { pageId?: { isSet?: boolean; not?: null } };
      }) =>
        args?.where?.pageId?.isSet === true && args.where.pageId.not === null
          ? 6
          : 10) as never);

      const crowi = buildCrowiWithEsClient(buildEsClientWithCardinality(6));

      const result = await computeRequiresReindex(crowi as never, true);

      expect(result).toBe(false);
    });

    it('returns false when mongoCount === esCount', async () => {
      countAttachments.mockResolvedValue(5);

      const esClient = buildEsClientWithCardinality(5);
      const crowi = buildCrowiWithEsClient(esClient);

      invalidateRequiresReindexCache();
      const result = await computeRequiresReindex(crowi as never, true);

      expect(result).toBe(false);
    });

    it('returns false when mongoCount < esCount (stale ES docs)', async () => {
      countAttachments.mockResolvedValue(3);

      const esClient = buildEsClientWithCardinality(7);
      const crowi = buildCrowiWithEsClient(esClient);

      invalidateRequiresReindexCache();
      const result = await computeRequiresReindex(crowi as never, true);

      expect(result).toBe(false);
    });

    it('returns false when isEnabled=false (search not enabled)', async () => {
      const esClient = buildEsClientWithCardinality(5);
      const crowi = buildCrowiWithEsClient(esClient);

      invalidateRequiresReindexCache();
      const result = await computeRequiresReindex(crowi as never, false);

      expect(result).toBe(false);
      // Should not even query MongoDB or ES when disabled
      expect(countAttachments).not.toHaveBeenCalled();
      expect(esClient.search).not.toHaveBeenCalled();
    });

    it('returns false when mongoCount is 0 (nothing to index)', async () => {
      countAttachments.mockResolvedValue(0);

      const esClient = buildEsClientWithCardinality(0);
      const crowi = buildCrowiWithEsClient(esClient);

      invalidateRequiresReindexCache();
      const result = await computeRequiresReindex(crowi as never, true);

      expect(result).toBe(false);
      // ES should not be queried when MongoDB has 0 attachments
      expect(esClient.search).not.toHaveBeenCalled();
    });

    it('cache: invalidateRequiresReindexCache causes next call to recompute', async () => {
      const esClient = {
        search: vi.fn(),
      };
      const crowi = buildCrowiWithEsClient(esClient);

      // First call: mongoCount=10, esCount=5 → requiresReindex=true
      countAttachments.mockResolvedValueOnce(10);
      esClient.search.mockResolvedValueOnce({
        aggregations: { unique_attachments: { value: 5 } },
      });

      invalidateRequiresReindexCache();
      const first = await computeRequiresReindex(crowi as never, true);
      expect(first).toBe(true);
      expect(esClient.search).toHaveBeenCalledTimes(1);

      // Second call WITHOUT invalidation → cached result (search NOT called again)
      const second = await computeRequiresReindex(crowi as never, true);
      expect(second).toBe(true);
      expect(esClient.search).toHaveBeenCalledTimes(1); // still 1

      // Simulate PUT success → cache invalidated
      invalidateRequiresReindexCache();

      // Third call AFTER invalidation: mongoCount=10, esCount=10 → requiresReindex=false
      countAttachments.mockResolvedValueOnce(10);
      esClient.search.mockResolvedValueOnce({
        aggregations: { unique_attachments: { value: 10 } },
      });

      const third = await computeRequiresReindex(crowi as never, true);
      expect(third).toBe(false);
      expect(esClient.search).toHaveBeenCalledTimes(2); // recomputed
    });
  });
});

// ---------------------------------------------------------------------------
// GET /failures — route-level tests using supertest
// ---------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import express from 'express';
import supertest from 'supertest';

// The login-required and admin-required factories are vi.mock'd below at the
// top of the describe block context. Vitest hoists vi.mock() calls to the
// top of the file, so the order relative to imports does not matter.
vi.mock('~/server/middlewares/login-required', () => ({
  default:
    () =>
    (
      _req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) =>
      next(),
}));

vi.mock('~/server/middlewares/admin-required', () => ({
  default:
    (_crowi: unknown) =>
    (
      req: express.Request & { user?: { admin?: boolean } },
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (req.user?.admin) {
        return next();
      }
      return res.status(403).json({ error: 'Forbidden' });
    },
}));

// The audit record is covered by attachment-search-admin.integ.ts
vi.mock('~/server/middlewares/add-activity', () => ({
  generateAddActivityMiddleware:
    () =>
    (
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      res.locals.activity = { _id: 'activity-id' };
      next();
    },
}));

vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser:
    () =>
    (
      _req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) =>
      next(),
}));

/**
 * Builds a minimal express app that wraps the admin router under /admin/attachment-search.
 * `isAdmin` controls whether the adminRequired middleware allows the request.
 */
function buildTestApp(
  isAdmin: boolean,
  ensureAttachmentIndex: () => Promise<void> = vi.fn(),
) {
  const app = express();
  app.use(express.json());

  // Inject req.user with admin flag for the mocked adminRequired middleware
  app.use(
    (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      // biome-ignore lint/suspicious/noExplicitAny: test helper — attaches minimal user fixture
      (req as any).user = { admin: isAdmin };
      next();
    },
  );

  // Attach apiv3 / apiv3Err helpers matching GROWI's API layer
  app.use(
    (
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      // biome-ignore lint/suspicious/noExplicitAny: test-only response helper
      (res as any).apiv3 = (data: unknown) => res.status(200).json(data);
      // biome-ignore lint/suspicious/noExplicitAny: test-only response helper
      (res as any).apiv3Err = (err: unknown, status = 400) =>
        res.status(status).json({ error: err });
      next();
    },
  );

  // Create a minimal Crowi stub
  const crowiStub = {
    searchService: { fullTextSearchDelegator: null, isConfigured: true },
    attachmentIndexOperations: { ensureAttachmentIndex },
    events: { activity: new EventEmitter() },
  };

  const router = attachmentSearchAdminFactory(crowiStub as never);
  app.use('/admin/attachment-search', router);

  return app;
}

describe('GET /failures', () => {
  beforeEach(() => {
    mockListRecent.mockReset();
    mockTotalRecent.mockReset();
    vi.mocked(configManager.getConfig).mockReset();
  });

  it('returns items and total with defaults (limit=50, no since)', async () => {
    const fakeItems = [
      {
        attachmentId: 'att1',
        pageId: 'page1',
        fileName: 'doc.pdf',
        fileFormat: 'pdf',
        fileSize: 1024,
        reasonCode: 'extractor_error',
        message: 'timeout',
        occurredAt: new Date('2025-01-01T00:00:00Z'),
      },
    ];

    mockListRecent.mockResolvedValue(fakeItems);
    mockTotalRecent.mockResolvedValue(1);

    const app = buildTestApp(true);
    const res = await supertest(app).get('/admin/attachment-search/failures');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].attachmentId).toBe('att1');

    // Verify defaults were passed to the service
    expect(mockListRecent).toHaveBeenCalledWith({
      limit: 50,
      since: undefined,
    });
    expect(mockTotalRecent).toHaveBeenCalledWith(undefined);
  });

  it('passes limit and since query params to the service', async () => {
    mockListRecent.mockResolvedValue([]);
    mockTotalRecent.mockResolvedValue(0);

    const app = buildTestApp(true);
    const sinceIso = '2025-06-01T00:00:00.000Z';
    const res = await supertest(app).get(
      `/admin/attachment-search/failures?limit=10&since=${encodeURIComponent(sinceIso)}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);

    // limit should be 10, since should be a Date matching the ISO string
    expect(mockListRecent).toHaveBeenCalledWith({
      limit: 10,
      since: new Date(sinceIso),
    });
    expect(mockTotalRecent).toHaveBeenCalledWith(new Date(sinceIso));
  });

  it.each([
    { name: 'a non-numeric limit', qs: 'limit=secret' },
    { name: 'a zero limit', qs: 'limit=0' },
    { name: 'a limit above 200', qs: 'limit=201' },
    { name: 'an operator-shaped limit', qs: 'limit[$gt]=0' },
    { name: 'a since that is not a date', qs: 'since=secret' },
  ])('rejects $name with 400 without querying the log', async ({ qs }) => {
    const app = buildTestApp(true);
    const res = await supertest(app).get(
      `/admin/attachment-search/failures?${qs}`,
    );

    expect(res.status).toBe(400);
    expect(res.text).not.toContain('secret');
    expect(mockListRecent).not.toHaveBeenCalled();
  });

  it('returns 403 when user is not an admin', async () => {
    const app = buildTestApp(false);
    const res = await supertest(app).get('/admin/attachment-search/failures');

    expect(res.status).toBe(403);
    // Service must not be called at all
    expect(mockListRecent).not.toHaveBeenCalled();
    expect(mockTotalRecent).not.toHaveBeenCalled();
  });
});

describe('GET /config', () => {
  it('reports a set token only as hasExtractorToken, never its value', async () => {
    const token = 'extractor-token-value-4f9c';
    vi.mocked(configManager.getConfig).mockImplementation(((key: string) =>
      key === 'app:attachmentFullTextSearch:extractorToken'
        ? token
        : undefined) as never);

    const res = await supertest(buildTestApp(true)).get(
      '/admin/attachment-search/config',
    );

    expect(res.status).toBe(200);
    expect(res.body.config.hasExtractorToken).toBe(true);
    expect(res.text).not.toContain(token);
  });

  it('reports a whitespace-only token as not set', async () => {
    vi.mocked(configManager.getConfig).mockImplementation(((key: string) =>
      key === 'app:attachmentFullTextSearch:extractorToken'
        ? ' \n'
        : undefined) as never);

    const res = await supertest(buildTestApp(true)).get(
      '/admin/attachment-search/config',
    );

    expect(res.status).toBe(200);
    expect(res.body.config.hasExtractorToken).toBe(false);
  });
});

describe('PUT /config validation', () => {
  const put = (body: Record<string, unknown>) =>
    supertest(buildTestApp(true))
      .put('/admin/attachment-search/config')
      .send(body);
  const storedUpdates = () =>
    vi.mocked(configManager.updateConfigs).mock.calls[0]?.[0];

  beforeEach(() => {
    vi.mocked(configManager.updateConfigs).mockReset();
    vi.mocked(configManager.updateConfigs).mockResolvedValue(undefined);
  });

  it.each([
    { timeoutMs: 999 },
    { timeoutMs: 600_001 },
    { timeoutMs: 1.5 },
    { timeoutMs: 'secret' },
    { maxFileSizeBytes: 0 },
    { maxFileSizeBytes: 500 * 1024 * 1024 + 1 },
    { maxFileSizeBytes: 'secret' },
    { extractorToken: 12345 },
    { extractorToken: { $ne: 'secret' } },
    { extractorToken: 'x'.repeat(1025) },
    { extractorUri: 'http://[::ffff:169.254.169.254]/' },
    { extractorUri: 'http://169.254.1.1/' },
    { extractorUri: 'http://metadata.google.internal/' },
  ])('rejects %o with 400 without storing anything', async (body) => {
    const res = await put(body);

    expect(res.status).toBe(400);
    expect(res.text).not.toContain('secret');
    expect(configManager.updateConfigs).not.toHaveBeenCalled();
  });

  it('stores the numbers as numbers, also when sent as strings', async () => {
    const res = await put({ timeoutMs: '30000', maxFileSizeBytes: '1048576' });

    expect(res.status).toBe(200);
    expect(storedUpdates()).toEqual({
      'app:attachmentFullTextSearch:timeoutMs': 30000,
      'app:attachmentFullTextSearch:maxFileSizeBytes': 1048576,
    });
  });

  it.each([
    { timeoutMs: 1000, maxFileSizeBytes: 1 },
    { timeoutMs: 600_000, maxFileSizeBytes: 500 * 1024 * 1024 },
  ])('accepts the bounds %o', async (body) => {
    const res = await put(body);

    expect(res.status).toBe(200);
    expect(storedUpdates()).toEqual({
      'app:attachmentFullTextSearch:timeoutMs': body.timeoutMs,
      'app:attachmentFullTextSearch:maxFileSizeBytes': body.maxFileSizeBytes,
    });
  });

  it('stores the token without its surrounding whitespace', async () => {
    expect((await put({ extractorToken: ' token-value\n' })).status).toBe(200);
    expect(storedUpdates()).toEqual({
      'app:attachmentFullTextSearch:extractorToken': 'token-value',
    });
  });

  it('clears the token when it is whitespace only', async () => {
    expect((await put({ extractorToken: ' \n' })).status).toBe(200);
    expect(storedUpdates()).toEqual({
      'app:attachmentFullTextSearch:extractorToken': undefined,
    });
  });

  it('stores a token string and clears it with null', async () => {
    expect((await put({ extractorToken: 'token-value' })).status).toBe(200);
    expect(storedUpdates()).toEqual({
      'app:attachmentFullTextSearch:extractorToken': 'token-value',
    });

    vi.mocked(configManager.updateConfigs).mockClear();
    expect((await put({ extractorToken: null })).status).toBe(200);
    expect(storedUpdates()).toEqual({
      'app:attachmentFullTextSearch:extractorToken': undefined,
    });
  });
});

describe('PUT /config — attachment index creation', () => {
  const setEnabled = (enabled: boolean) =>
    vi.mocked(configManager.getConfig).mockImplementation(((key: string) => {
      if (key === 'app:attachmentFullTextSearch:extractorUri')
        return enabled ? 'http://extractor:8000' : undefined;
      if (key === 'app:attachmentFullTextSearch:extractorToken')
        return enabled ? 'token' : undefined;
      return undefined;
    }) as never);

  beforeEach(() => {
    vi.mocked(configManager.updateConfigs).mockReset();
    vi.mocked(configManager.updateConfigs).mockResolvedValue(undefined);
  });

  it('creates the attachment index when the feature is enabled after the update', async () => {
    setEnabled(true);
    const ensureAttachmentIndex = vi.fn().mockResolvedValue(undefined);

    const res = await supertest(buildTestApp(true, ensureAttachmentIndex))
      .put('/admin/attachment-search/config')
      .send({ extractorUri: 'http://extractor:8000', extractorToken: 'token' });

    expect(res.status).toBe(200);
    expect(ensureAttachmentIndex).toHaveBeenCalledOnce();
  });

  it('does not create the attachment index while the feature stays disabled', async () => {
    setEnabled(false);
    const ensureAttachmentIndex = vi.fn().mockResolvedValue(undefined);

    const res = await supertest(buildTestApp(true, ensureAttachmentIndex))
      .put('/admin/attachment-search/config')
      .send({ timeoutMs: 30000 });

    expect(res.status).toBe(200);
    expect(ensureAttachmentIndex).not.toHaveBeenCalled();
  });

  it('still saves the config when the index cannot be created', async () => {
    setEnabled(true);
    const ensureAttachmentIndex = vi
      .fn()
      .mockRejectedValue(new Error('ES is down'));

    const res = await supertest(buildTestApp(true, ensureAttachmentIndex))
      .put('/admin/attachment-search/config')
      .send({ extractorUri: 'http://extractor:8000', extractorToken: 'token' });

    expect(res.status).toBe(200);
    expect(configManager.updateConfigs).toHaveBeenCalledOnce();
  });
});
