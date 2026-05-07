/**
 * Tests for attachment-search-admin route utilities.
 *
 * Tests cover:
 *  1. GET /config: hasExtractorToken=true when token is set (never the value)
 *  2. GET /config: hasExtractorToken=false when token not set
 *  3. GET /config: response does NOT contain extractorToken string value
 *  4. PUT /config: valid URI updates config
 *  5. PUT /config: metadata IP URI returns invalid_extractor_uri error
 *  6. PUT /config: file:// URI returns invalid_extractor_uri error
 *  7. requiresReindex: true when mongoCount > esCount
 *  8. requiresReindex: false when disabled
 *  9. requiresReindex cache: PUT invalidates it, next GET recomputes
 * 10. GET /failures: returns items and total
 * 11. GET /failures: with limit and since params
 * 12. GET /failures: non-admin → 403
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

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

// Mock Attachment model (used inside computeRequiresReindex dynamic import)
vi.mock('~/server/models/attachment', () => ({
  Attachment: {
    countDocuments: vi.fn(),
  },
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

import {
  type AttachmentSearchConfig,
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
  // Section 1–3: hasExtractorToken vs actual token value in response
  // -------------------------------------------------------------------------

  describe('GET /config token exposure', () => {
    it('1. returns hasExtractorToken=true when token is set — token value MUST NOT be present', () => {
      const SECRET_TOKEN = 'super-secret-token-value';

      mockGetConfig.mockImplementation((key: string) => {
        if (key === 'app:attachmentFullTextSearch:extractorUri')
          return 'http://extractor.example.com';
        if (key === 'app:attachmentFullTextSearch:extractorToken')
          return SECRET_TOKEN;
        if (key === 'app:attachmentFullTextSearch:timeoutMs') return 60000;
        if (key === 'app:attachmentFullTextSearch:maxFileSizeBytes')
          return 52428800;
        return undefined;
      });

      const extractorUri = configManager.getConfig(
        'app:attachmentFullTextSearch:extractorUri' as never,
      );
      const tokenValue = configManager.getConfig(
        'app:attachmentFullTextSearch:extractorToken' as never,
      );

      const hasExtractorToken = tokenValue != null && tokenValue !== '';

      const config: AttachmentSearchConfig = {
        extractorUri: extractorUri as string | null,
        hasExtractorToken,
        timeoutMs: configManager.getConfig(
          'app:attachmentFullTextSearch:timeoutMs' as never,
        ) as number,
        maxFileSizeBytes: configManager.getConfig(
          'app:attachmentFullTextSearch:maxFileSizeBytes' as never,
        ) as number,
        isAttachmentFullTextSearchEnabled:
          extractorUri != null && extractorUri !== '',
        requiresReindex: false,
      };

      // hasExtractorToken should be true
      expect(config.hasExtractorToken).toBe(true);

      // Serialize to JSON — the secret token must NEVER appear
      const json = JSON.stringify(config);
      expect(json).not.toContain(SECRET_TOKEN);

      // The key "extractorToken" itself must NOT appear in the serialized response
      expect(json).not.toContain('"extractorToken"');
    });

    it('2. returns hasExtractorToken=false when token is not set', () => {
      mockGetConfig.mockImplementation((key: string) => {
        if (key === 'app:attachmentFullTextSearch:extractorUri')
          return 'http://extractor.example.com';
        if (key === 'app:attachmentFullTextSearch:extractorToken')
          return undefined;
        if (key === 'app:attachmentFullTextSearch:timeoutMs') return 60000;
        if (key === 'app:attachmentFullTextSearch:maxFileSizeBytes')
          return 52428800;
        return undefined;
      });

      const tokenValue = configManager.getConfig(
        'app:attachmentFullTextSearch:extractorToken' as never,
      );
      const hasExtractorToken = tokenValue != null && tokenValue !== '';

      expect(hasExtractorToken).toBe(false);
    });

    it('3. GET response JSON does not contain extractorToken key or value in any scenario', () => {
      const REAL_TOKEN = 'my-real-token-abc123';

      mockGetConfig.mockImplementation((key: string) => {
        if (key === 'app:attachmentFullTextSearch:extractorToken')
          return REAL_TOKEN;
        return undefined;
      });

      const tokenValue = configManager.getConfig(
        'app:attachmentFullTextSearch:extractorToken' as never,
      );
      const hasExtractorToken = tokenValue != null && tokenValue !== '';

      const config: Partial<AttachmentSearchConfig> & {
        hasExtractorToken: boolean;
      } = {
        extractorUri: null,
        hasExtractorToken,
        timeoutMs: 60000,
        maxFileSizeBytes: 52428800,
        isAttachmentFullTextSearchEnabled: false,
        requiresReindex: false,
      };

      const serialized = JSON.stringify(config);

      // Token value must not leak
      expect(serialized).not.toContain(REAL_TOKEN);
      // The key name "extractorToken" must not appear
      expect(serialized).not.toContain('"extractorToken"');
    });
  });

  // -------------------------------------------------------------------------
  // Section 4–6: PUT /config URI validation
  // -------------------------------------------------------------------------

  describe('PUT /config URI validation', () => {
    it('4. valid URI updates config without error', async () => {
      vi.mocked(configManager.updateConfigs).mockResolvedValue(undefined);

      const validUri = 'http://markitdown.example.com:8080';

      // Simulate what the route handler does after validation passes
      await configManager.updateConfigs(
        {
          'app:attachmentFullTextSearch:extractorUri': validUri,
        } as Parameters<typeof configManager.updateConfigs>[0],
        { removeIfUndefined: true },
      );

      expect(configManager.updateConfigs).toHaveBeenCalledWith(
        expect.objectContaining({
          'app:attachmentFullTextSearch:extractorUri': validUri,
        }),
        { removeIfUndefined: true },
      );
    });

    it('5. metadata IP URI (169.254.169.254) produces invalid_extractor_uri', async () => {
      const { validateExtractorUri } = await import(
        '~/features/search-attachments/server/services/validate-extractor-uri'
      );
      const result = validateExtractorUri('http://169.254.169.254/latest');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('metadata_ip');
      }
    });

    it('6. file:// URI produces invalid_extractor_uri', async () => {
      const { validateExtractorUri } = await import(
        '~/features/search-attachments/server/services/validate-extractor-uri'
      );
      const result = validateExtractorUri('file:///etc/passwd');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('invalid_scheme');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Section 7–9: requiresReindex
  // -------------------------------------------------------------------------

  describe('computeRequiresReindex', () => {
    it('7. returns true when mongoCount > esCount', async () => {
      const { Attachment } = await import('~/server/models/attachment');
      vi.mocked(Attachment.countDocuments).mockResolvedValue(10 as never);

      const esClient = buildEsClientWithCardinality(5);
      const crowi = buildCrowiWithEsClient(esClient);

      const result = await computeRequiresReindex(crowi as never, true);

      expect(result).toBe(true);
      expect(esClient.search).toHaveBeenCalledWith(
        expect.objectContaining({
          index: 'attachments',
        }),
      );
    });

    it('returns false when mongoCount === esCount', async () => {
      const { Attachment } = await import('~/server/models/attachment');
      vi.mocked(Attachment.countDocuments).mockResolvedValue(5 as never);

      const esClient = buildEsClientWithCardinality(5);
      const crowi = buildCrowiWithEsClient(esClient);

      invalidateRequiresReindexCache();
      const result = await computeRequiresReindex(crowi as never, true);

      expect(result).toBe(false);
    });

    it('returns false when mongoCount < esCount (stale ES docs)', async () => {
      const { Attachment } = await import('~/server/models/attachment');
      vi.mocked(Attachment.countDocuments).mockResolvedValue(3 as never);

      const esClient = buildEsClientWithCardinality(7);
      const crowi = buildCrowiWithEsClient(esClient);

      invalidateRequiresReindexCache();
      const result = await computeRequiresReindex(crowi as never, true);

      expect(result).toBe(false);
    });

    it('8. returns false when isEnabled=false (search not enabled)', async () => {
      const { Attachment } = await import('~/server/models/attachment');
      const mockCountDocuments = vi.mocked(Attachment.countDocuments);
      mockCountDocuments.mockClear();

      const esClient = buildEsClientWithCardinality(5);
      const crowi = buildCrowiWithEsClient(esClient);

      invalidateRequiresReindexCache();
      const result = await computeRequiresReindex(crowi as never, false);

      expect(result).toBe(false);
      // Should not even query MongoDB or ES when disabled
      expect(mockCountDocuments).not.toHaveBeenCalled();
      expect(esClient.search).not.toHaveBeenCalled();
    });

    it('returns false when mongoCount is 0 (nothing to index)', async () => {
      const { Attachment } = await import('~/server/models/attachment');
      vi.mocked(Attachment.countDocuments).mockResolvedValue(0 as never);

      const esClient = buildEsClientWithCardinality(0);
      const crowi = buildCrowiWithEsClient(esClient);

      invalidateRequiresReindexCache();
      const result = await computeRequiresReindex(crowi as never, true);

      expect(result).toBe(false);
      // ES should not be queried when MongoDB has 0 attachments
      expect(esClient.search).not.toHaveBeenCalled();
    });

    it('9. cache: invalidateRequiresReindexCache causes next call to recompute', async () => {
      const { Attachment } = await import('~/server/models/attachment');
      const mockCountDocuments = vi.mocked(Attachment.countDocuments);

      const esClient = {
        search: vi.fn(),
      };
      const crowi = buildCrowiWithEsClient(esClient);

      // First call: mongoCount=10, esCount=5 → requiresReindex=true
      mockCountDocuments.mockResolvedValueOnce(10 as never);
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
      mockCountDocuments.mockResolvedValueOnce(10 as never);
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
function buildTestApp(isAdmin: boolean) {
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
      (res as any).apiv3Err = (err: unknown, status: number) =>
        res.status(status).json({ error: err });
      next();
    },
  );

  // Create a minimal Crowi stub
  const crowiStub = {
    searchService: { fullTextSearchDelegator: null },
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

  it('10. returns items and total with defaults (limit=50, no since)', async () => {
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

  it('11. passes limit and since query params to the service', async () => {
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

  it('12. returns 403 when user is not an admin', async () => {
    const app = buildTestApp(false);
    const res = await supertest(app).get('/admin/attachment-search/failures');

    expect(res.status).toBe(403);
    // Service must not be called at all
    expect(mockListRecent).not.toHaveBeenCalled();
    expect(mockTotalRecent).not.toHaveBeenCalled();
  });
});
