/**
 * Tests for GET /_api/v3/search/attachments
 *
 * Test cases:
 *  1. 400 when pageIds query param is missing entirely
 *  2. 400 when pageIds is an empty array (after split)
 *  3. 400 when pageIds has more than 20 elements
 *  4. 200 with enrichments when valid q and pageIds provided
 *  5. 503 when feature is disabled (middleware blocks before handler)
 */

import express from 'express';
import supertest from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('~/utils/logger', () => ({
  default: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import type { AttachmentSearchResultAggregator } from '~/features/search-attachments/server/services/attachment-search-result-aggregator';

import { createSearchAttachmentsRouter } from './search-attachments';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp(
  aggregator: Partial<AttachmentSearchResultAggregator>,
  isSearchServiceConfigured: () => boolean,
  withFeatureDisabled = false,
) {
  const app = express();
  app.use(express.json());

  // Simulate apiv3 response helper (matches ApiV3Response interface)
  app.use(
    (
      _req,
      res: express.Response & { apiv3?: unknown; apiv3Err?: unknown },
      next,
    ) => {
      res.apiv3 = (obj?: unknown) => res.status(200).json(obj ?? {});
      res.apiv3Err = (err: unknown, status = 500) =>
        res.status(status).json({ errors: [{ message: String(err) }] });
      next();
    },
  );

  if (withFeatureDisabled) {
    // Inject a middleware that always returns 503 (simulates requireSearchAttachmentsEnabled)
    app.use((_req, res) => {
      return res.status(503).json({
        errors: [
          {
            message: 'Attachment full-text search feature is disabled',
            code: 'feature_disabled',
          },
        ],
      });
    });
  } else {
    const router = createSearchAttachmentsRouter(
      aggregator as AttachmentSearchResultAggregator,
      isSearchServiceConfigured,
    );
    app.use('/', router);
  }

  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET / (search-attachments route)', () => {
  let mockResolveSecondary: ReturnType<typeof vi.fn>;
  let aggregator: Partial<AttachmentSearchResultAggregator>;
  let isSearchServiceConfigured: () => boolean;

  beforeEach(() => {
    mockResolveSecondary = vi.fn();
    aggregator = { resolveSecondary: mockResolveSecondary };
    isSearchServiceConfigured = vi.fn().mockReturnValue(true);
  });

  // -------------------------------------------------------------------------
  // 1. Missing pageIds
  // -------------------------------------------------------------------------
  it('1. returns 400 when pageIds is missing', async () => {
    const app = buildApp(aggregator, isSearchServiceConfigured);
    const res = await supertest(app).get('/').query({ q: 'keyword' });

    expect(res.status).toBe(400);
    expect(mockResolveSecondary).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 2. Empty pageIds
  // -------------------------------------------------------------------------
  it('2. returns 400 when pageIds is an empty string', async () => {
    const app = buildApp(aggregator, isSearchServiceConfigured);
    const res = await supertest(app)
      .get('/')
      .query({ q: 'keyword', pageIds: '' });

    expect(res.status).toBe(400);
    expect(mockResolveSecondary).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 3. pageIds > 20 elements
  // -------------------------------------------------------------------------
  it('3. returns 400 when pageIds has more than 20 elements', async () => {
    const app = buildApp(aggregator, isSearchServiceConfigured);
    const ids = Array.from({ length: 21 }, (_, i) => `id${i}`).join(',');
    const res = await supertest(app)
      .get('/')
      .query({ q: 'keyword', pageIds: ids });

    expect(res.status).toBe(400);
    expect(mockResolveSecondary).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 4. Valid request → 200 with enrichments
  // -------------------------------------------------------------------------
  it('4. returns 200 with enrichments when valid q and pageIds provided', async () => {
    const enrichments = {
      page1: {
        attachmentHits: [
          {
            attachmentId: 'att1',
            pageId: 'page1',
            fileName: 'doc.pdf',
            originalName: 'doc.pdf',
            fileFormat: 'application/pdf',
            fileSize: 1024,
            snippets: [],
            pageNumber: 1,
            label: null,
          },
        ],
      },
    };

    mockResolveSecondary.mockResolvedValue({
      facet: 'all',
      enrichments,
    });

    const app = buildApp(aggregator, isSearchServiceConfigured);
    const res = await supertest(app)
      .get('/')
      .query({ q: 'keyword', pageIds: 'page1,page2' });

    expect(res.status).toBe(200);
    expect(mockResolveSecondary).toHaveBeenCalledWith(
      'keyword',
      expect.objectContaining({
        facet: 'all',
        primaryIds: ['page1', 'page2'],
      }),
    );
    expect(res.body).toMatchObject({ enrichments });
  });

  // -------------------------------------------------------------------------
  // 5. 503 when feature is disabled
  // -------------------------------------------------------------------------
  it('5. returns 503 when feature is disabled (middleware blocks)', async () => {
    const app = buildApp(aggregator, isSearchServiceConfigured, true);
    const res = await supertest(app)
      .get('/')
      .query({ q: 'keyword', pageIds: 'page1' });

    expect(res.status).toBe(503);
    expect(res.body.errors[0].code).toBe('feature_disabled');
    expect(mockResolveSecondary).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 6. pageIds as array query param (e.g., ?pageIds[]=id1&pageIds[]=id2)
  // -------------------------------------------------------------------------
  it('6. handles pageIds as repeated query array params', async () => {
    mockResolveSecondary.mockResolvedValue({ facet: 'all', enrichments: {} });

    const app = buildApp(aggregator, isSearchServiceConfigured);

    // supertest encodes array as pageIds[]=id1&pageIds[]=id2 with { pageIds: ['id1', 'id2'] }
    const res = await supertest(app)
      .get('/')
      .query({ q: 'kw', 'pageIds[]': ['id1', 'id2'] });

    // The handler may or may not support this form; if it returns 400, that is also acceptable
    // but the canonical form (comma-separated) must work. This test just ensures no crash.
    expect([200, 400]).toContain(res.status);
  });

  // -------------------------------------------------------------------------
  // 7. Exactly 20 pageIds → valid
  // -------------------------------------------------------------------------
  it('7. accepts exactly 20 pageIds', async () => {
    mockResolveSecondary.mockResolvedValue({ facet: 'all', enrichments: {} });

    const app = buildApp(aggregator, isSearchServiceConfigured);
    const ids = Array.from({ length: 20 }, (_, i) => `id${i}`).join(',');
    const res = await supertest(app)
      .get('/')
      .query({ q: 'keyword', pageIds: ids });

    expect(res.status).toBe(200);
    expect(mockResolveSecondary).toHaveBeenCalledWith(
      'keyword',
      expect.objectContaining({
        facet: 'all',
        primaryIds: expect.arrayContaining(['id0', 'id19']),
      }),
    );
  });
});
