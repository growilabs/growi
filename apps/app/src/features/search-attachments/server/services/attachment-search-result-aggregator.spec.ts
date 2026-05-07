/**
 * Unit tests for AttachmentSearchResultAggregator
 *
 * All dependencies are mocked. Tests verify:
 * 1. facet=pages: does NOT call attachment search
 * 2. facet=all, from=0: calls both page AND attachment search; embeds only matching pageIds
 * 3. facet=all, from>0: only calls page search (no attachment query)
 * 4. facet=attachments: calls attachment search first, then mget for permission
 * 5. facet=all over 800ms → degrades to pages-only result
 * 6. facet=attachments over 800ms → returns empty + primaryResultIncomplete:true
 * 7. facet=pages returns correct primarySlot='pages'
 * 8. facet=attachments returns correct primarySlot='attachments'
 * 9. resolveSecondary facet=all: returns attachment hits grouped by pageId
 * 10. resolveSecondary facet=all: secondary timeout → empty enrichments
 * 11. resolveSecondary facet=all: primaryIds > 20 → throws RangeError
 * 12. resolveSecondary facet=attachments: returns empty enrichments (no-op)
 * 13. fail-close: mget all found:true → all included
 * 14. fail-close: mget some found:false → only found:true docs included
 * 15. fail-close: mget with errors array → only success docs (no error) included
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AttachmentIndexClient,
  AttachmentSearchResponse,
  MgetDoc,
  MgetPagesResponse,
  PageSearchFn,
} from './attachment-search-result-aggregator';
import {
  AttachmentSearchResultAggregator,
  filterMgetDocs,
} from './attachment-search-result-aggregator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal page search result */
const makePageSearchResult = (pageIds: string[]) => ({
  meta: { total: pageIds.length, took: 5, hitsCount: pageIds.length },
  data: pageIds.map((id) => ({
    _id: id,
    _score: 1.0,
    _source: { path: `/page/${id}` },
    _highlight: { body: [`snippet for ${id}`], path: [`/page/${id}`] },
  })),
});

/** Build a minimal attachment search response */
const makeAttachmentResponse = (
  hits: Array<{ pageId: string; attachmentId: string }>,
): AttachmentSearchResponse => ({
  hits: {
    total: { value: hits.length },
    hits: hits.map(({ pageId, attachmentId }) => ({
      _id: `${attachmentId}_1`,
      _score: 0.9,
      _source: {
        attachmentId,
        pageId,
        fileName: `${attachmentId}.pdf`,
        originalName: `${attachmentId}.pdf`,
        fileFormat: 'application/pdf',
        fileSize: 1024,
        pageNumber: 1,
        label: null,
      },
      highlight: {
        content: ['<em>matching</em> content'],
      },
    })),
  },
});

/** Build a minimal mget pages response */
const makeMgetResponse = (
  docs: Array<{ id: string; found: boolean; error?: unknown }>,
): MgetPagesResponse => ({
  docs: docs.map(({ id, found, error }) => {
    const doc: MgetDoc = { _id: id, found };
    if (error !== undefined) doc.error = error;
    return doc;
  }),
});

// ---------------------------------------------------------------------------
// Test factory
// ---------------------------------------------------------------------------

function makeAggregator(
  pageSearchFn: PageSearchFn,
  attachmentClient: AttachmentIndexClient,
  timeoutMs = 800,
) {
  return new AttachmentSearchResultAggregator(
    pageSearchFn,
    attachmentClient,
    timeoutMs,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AttachmentSearchResultAggregator.searchPrimary', () => {
  let pageSearchFn: ReturnType<typeof vi.fn>;
  let searchAttachments: ReturnType<typeof vi.fn>;
  let mgetPages: ReturnType<typeof vi.fn>;
  let attachmentClient: AttachmentIndexClient;

  beforeEach(() => {
    pageSearchFn = vi.fn();
    searchAttachments = vi.fn();
    mgetPages = vi.fn();
    attachmentClient = { searchAttachments, mgetPages };
  });

  // -------------------------------------------------------------------------
  // 1. facet=pages: MUST NOT call attachment search
  // -------------------------------------------------------------------------
  describe('facet=pages', () => {
    it('does NOT call attachment search or mget', async () => {
      pageSearchFn.mockResolvedValue(makePageSearchResult(['page1', 'page2']));

      const agg = makeAggregator(pageSearchFn, attachmentClient);
      const _result = await agg.searchPrimary('keyword', {
        facet: 'pages',
        from: 0,
        size: 20,
      });

      expect(searchAttachments).not.toHaveBeenCalled();
      expect(mgetPages).not.toHaveBeenCalled();
      expect(pageSearchFn).toHaveBeenCalledOnce();
    });

    // 7. facet=pages returns correct primarySlot='pages'
    it('returns primarySlot="pages"', async () => {
      pageSearchFn.mockResolvedValue(makePageSearchResult(['page1']));

      const agg = makeAggregator(pageSearchFn, attachmentClient);
      const result = await agg.searchPrimary('keyword', {
        facet: 'pages',
        from: 0,
        size: 20,
      });

      expect(result.facet).toBe('pages');
      expect(result.primarySlot).toBe('pages');
    });

    it('returns items with correct structure from page search data', async () => {
      pageSearchFn.mockResolvedValue(makePageSearchResult(['page1', 'page2']));

      const agg = makeAggregator(pageSearchFn, attachmentClient);
      const result = await agg.searchPrimary('keyword', {
        facet: 'pages',
        from: 0,
        size: 20,
      });

      expect(result.items).toHaveLength(2);
      expect(result.items[0].data._id).toBe('page1');
      expect(result.items[1].data._id).toBe('page2');
      expect(result.meta.total).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // 2. facet=all, from=0: calls both page AND attachment search; embeds matching pageIds
  // -------------------------------------------------------------------------
  describe('facet=all, from=0', () => {
    it('calls both page search and attachment search', async () => {
      pageSearchFn.mockResolvedValue(makePageSearchResult(['page1', 'page2']));
      searchAttachments.mockResolvedValue(
        makeAttachmentResponse([
          { pageId: 'page1', attachmentId: 'att1' },
          { pageId: 'page3', attachmentId: 'att2' }, // pageId NOT in page results
        ]),
      );

      const agg = makeAggregator(pageSearchFn, attachmentClient);
      await agg.searchPrimary('keyword', { facet: 'all', from: 0, size: 20 });

      expect(pageSearchFn).toHaveBeenCalledOnce();
      expect(searchAttachments).toHaveBeenCalledOnce();
      expect(mgetPages).not.toHaveBeenCalled();
    });

    it('embeds attachment hits only for pageIds present in page results (Interpretation A)', async () => {
      pageSearchFn.mockResolvedValue(makePageSearchResult(['page1', 'page2']));
      searchAttachments.mockResolvedValue(
        makeAttachmentResponse([
          { pageId: 'page1', attachmentId: 'att1' }, // in page results
          { pageId: 'page3', attachmentId: 'att2' }, // NOT in page results — discard
        ]),
      );

      const agg = makeAggregator(pageSearchFn, attachmentClient);
      const result = await agg.searchPrimary('keyword', {
        facet: 'all',
        from: 0,
        size: 20,
      });

      // page1 should have attachmentHits, page2 should not (no matching attachment), page3 discarded
      const page1 = result.items.find((i) => i.data._id === 'page1');
      const page2 = result.items.find((i) => i.data._id === 'page2');

      expect(page1?.meta?.attachmentHits).toHaveLength(1);
      expect(page1?.meta?.attachmentHits?.[0].attachmentId).toBe('att1');
      expect(page2?.meta?.attachmentHits).toBeUndefined(); // no attachment hits
      expect(result.items).toHaveLength(2); // page3 is not included
    });

    it('returns facet="all" and primarySlot="pages"', async () => {
      pageSearchFn.mockResolvedValue(makePageSearchResult(['page1']));
      searchAttachments.mockResolvedValue(makeAttachmentResponse([]));

      const agg = makeAggregator(pageSearchFn, attachmentClient);
      const result = await agg.searchPrimary('keyword', {
        facet: 'all',
        from: 0,
        size: 20,
      });

      expect(result.facet).toBe('all');
      expect(result.primarySlot).toBe('pages');
    });
  });

  // -------------------------------------------------------------------------
  // 3. facet=all, from>0: ONLY calls page search (no attachment query)
  // -------------------------------------------------------------------------
  describe('facet=all, from>0', () => {
    it('does NOT call attachment search', async () => {
      pageSearchFn.mockResolvedValue(makePageSearchResult(['page3', 'page4']));

      const agg = makeAggregator(pageSearchFn, attachmentClient);
      const _result = await agg.searchPrimary('keyword', {
        facet: 'all',
        from: 20,
        size: 20,
      });

      expect(pageSearchFn).toHaveBeenCalledOnce();
      expect(searchAttachments).not.toHaveBeenCalled();
      expect(mgetPages).not.toHaveBeenCalled();
    });

    it('returns items from page search with no attachmentHits', async () => {
      pageSearchFn.mockResolvedValue(makePageSearchResult(['page3', 'page4']));

      const agg = makeAggregator(pageSearchFn, attachmentClient);
      const result = await agg.searchPrimary('keyword', {
        facet: 'all',
        from: 20,
        size: 20,
      });

      expect(result.items).toHaveLength(2);
      for (const item of result.items) {
        expect(item.meta?.attachmentHits).toBeUndefined();
      }
    });
  });

  // -------------------------------------------------------------------------
  // 4. facet=attachments: calls attachment search first, then mget for permission
  // -------------------------------------------------------------------------
  describe('facet=attachments', () => {
    it('calls attachment search and then mget for permission filtering', async () => {
      searchAttachments.mockResolvedValue(
        makeAttachmentResponse([
          { pageId: 'page1', attachmentId: 'att1' },
          { pageId: 'page2', attachmentId: 'att2' },
        ]),
      );
      mgetPages.mockResolvedValue(
        makeMgetResponse([
          { id: 'page1', found: true },
          { id: 'page2', found: true },
        ]),
      );

      const agg = makeAggregator(pageSearchFn, attachmentClient);
      await agg.searchPrimary('keyword', {
        facet: 'attachments',
        from: 0,
        size: 20,
      });

      expect(pageSearchFn).not.toHaveBeenCalled();
      expect(searchAttachments).toHaveBeenCalledOnce();
      expect(mgetPages).toHaveBeenCalledOnce();
    });

    // 8. facet=attachments returns correct primarySlot='attachments'
    it('returns primarySlot="attachments"', async () => {
      searchAttachments.mockResolvedValue(
        makeAttachmentResponse([{ pageId: 'page1', attachmentId: 'att1' }]),
      );
      mgetPages.mockResolvedValue(
        makeMgetResponse([{ id: 'page1', found: true }]),
      );

      const agg = makeAggregator(pageSearchFn, attachmentClient);
      const result = await agg.searchPrimary('keyword', {
        facet: 'attachments',
        from: 0,
        size: 20,
      });

      expect(result.facet).toBe('attachments');
      expect(result.primarySlot).toBe('attachments');
    });

    it('drops pages where found=false (permission filter)', async () => {
      searchAttachments.mockResolvedValue(
        makeAttachmentResponse([
          { pageId: 'page1', attachmentId: 'att1' },
          { pageId: 'page2', attachmentId: 'att2' }, // will be dropped
        ]),
      );
      mgetPages.mockResolvedValue(
        makeMgetResponse([
          { id: 'page1', found: true },
          { id: 'page2', found: false }, // unauthorized / deleted
        ]),
      );

      const agg = makeAggregator(pageSearchFn, attachmentClient);
      const result = await agg.searchPrimary('keyword', {
        facet: 'attachments',
        from: 0,
        size: 20,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].data._id).toBe('page1');
    });

    it('returns primaryResultIncomplete=true when size is not met after permission drop', async () => {
      // size=2, overFetch=3 hits, but 2 are unauthorized
      const twoHits = makeAttachmentResponse([
        { pageId: 'page1', attachmentId: 'att1' },
        { pageId: 'page2', attachmentId: 'att2' },
        { pageId: 'page3', attachmentId: 'att3' },
      ]);
      searchAttachments.mockResolvedValue(twoHits);
      mgetPages.mockResolvedValue(
        makeMgetResponse([
          { id: 'page1', found: true },
          { id: 'page2', found: false },
          { id: 'page3', found: false },
        ]),
      );

      const agg = makeAggregator(pageSearchFn, attachmentClient);
      const result = await agg.searchPrimary('keyword', {
        facet: 'attachments',
        from: 0,
        size: 2, // requested 2, over-fetched 3, only 1 authorized
      });

      expect(result.items).toHaveLength(1);
      expect(result.meta.primaryResultIncomplete).toBe(true);
    });

    it('returns primaryResultIncomplete=false when size is fully met', async () => {
      searchAttachments.mockResolvedValue(
        makeAttachmentResponse([{ pageId: 'page1', attachmentId: 'att1' }]),
      );
      mgetPages.mockResolvedValue(
        makeMgetResponse([{ id: 'page1', found: true }]),
      );

      const agg = makeAggregator(pageSearchFn, attachmentClient);
      const result = await agg.searchPrimary('keyword', {
        facet: 'attachments',
        from: 0,
        size: 20,
      });

      expect(result.meta.primaryResultIncomplete).toBe(false);
    });

    it('passes unique pageIds to mget (deduplicating across multi-page attachments)', async () => {
      // Both hits belong to the same page (e.g. a multi-page PDF)
      searchAttachments.mockResolvedValue(
        makeAttachmentResponse([
          { pageId: 'page1', attachmentId: 'att1' },
          { pageId: 'page1', attachmentId: 'att1' }, // duplicate pageId
        ]),
      );
      mgetPages.mockResolvedValue(
        makeMgetResponse([{ id: 'page1', found: true }]),
      );

      const agg = makeAggregator(pageSearchFn, attachmentClient);
      await agg.searchPrimary('keyword', {
        facet: 'attachments',
        from: 0,
        size: 20,
      });

      // mget should be called with deduplicated pageIds
      const calledWith = mgetPages.mock.calls[0][0] as string[];
      expect(calledWith).toEqual(['page1']); // deduped
    });
  });

  // -------------------------------------------------------------------------
  // 5. facet=all over 800ms → degrades to pages-only
  // -------------------------------------------------------------------------
  describe('safety net: facet=all timeout', () => {
    it('degrades to pages-only result when primary exceeds timeout', async () => {
      // First call (parallel both) times out; second call (degraded) succeeds
      let callCount = 0;
      pageSearchFn.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // Simulate the parallel page search taking too long
          await new Promise((resolve) => setTimeout(resolve, 200));
          return makePageSearchResult(['page1']);
        }
        // Second call (degraded fallback) resolves immediately
        return makePageSearchResult(['page2']);
      });

      // Attachment search also takes too long
      searchAttachments.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(makeAttachmentResponse([])), 200),
          ),
      );

      // Use a very short timeout (50ms) to trigger the safety net
      const agg = makeAggregator(pageSearchFn, attachmentClient, 50);
      const result = await agg.searchPrimary('keyword', {
        facet: 'all',
        from: 0,
        size: 20,
      });

      // Should have fallen back to pages-only — no attachmentHits on any item
      expect(result.primarySlot).toBe('pages');
      for (const item of result.items) {
        expect(item.meta?.attachmentHits).toBeUndefined();
      }
    });
  });

  // -------------------------------------------------------------------------
  // 6. facet=attachments over 800ms → empty + primaryResultIncomplete:true
  // -------------------------------------------------------------------------
  describe('safety net: facet=attachments timeout', () => {
    it('returns empty items + primaryResultIncomplete=true when attachment search exceeds timeout', async () => {
      searchAttachments.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve(
                  makeAttachmentResponse([
                    { pageId: 'p1', attachmentId: 'a1' },
                  ]),
                ),
              200,
            ),
          ),
      );

      const agg = makeAggregator(pageSearchFn, attachmentClient, 50);
      const result = await agg.searchPrimary('keyword', {
        facet: 'attachments',
        from: 0,
        size: 20,
      });

      expect(result.items).toHaveLength(0);
      expect(result.meta.primaryResultIncomplete).toBe(true);
      expect(result.facet).toBe('attachments');
      expect(result.primarySlot).toBe('attachments');
      expect(pageSearchFn).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Attachment hit mapping: snippets are built from highlight fragments
  // -------------------------------------------------------------------------
  describe('attachment hit snippet building', () => {
    it('parses ES highlight fragments into ISnippetSegment[]', async () => {
      searchAttachments.mockResolvedValue({
        hits: {
          total: { value: 1 },
          hits: [
            {
              _id: 'att1_1',
              _score: 0.9,
              _source: {
                attachmentId: 'att1',
                pageId: 'page1',
                fileName: 'doc.pdf',
                originalName: 'doc.pdf',
                fileFormat: 'application/pdf',
                fileSize: 512,
                pageNumber: 1,
                label: null,
              },
              highlight: {
                content: ['hello <em>world</em> foo'],
              },
            },
          ],
        },
      });
      mgetPages.mockResolvedValue(
        makeMgetResponse([{ id: 'page1', found: true }]),
      );

      const agg = makeAggregator(pageSearchFn, attachmentClient);
      const result = await agg.searchPrimary('keyword', {
        facet: 'attachments',
        from: 0,
        size: 20,
      });

      const hits = result.items[0].meta?.attachmentHits ?? [];
      expect(hits).toHaveLength(1);
      expect(hits[0].snippets).toEqual([
        { text: 'hello ', highlighted: false },
        { text: 'world', highlighted: true },
        { text: ' foo', highlighted: false },
      ]);
    });
  });
});

// ---------------------------------------------------------------------------
// Task 7.3: filterMgetDocs — fail-close unit tests
// ---------------------------------------------------------------------------

describe('filterMgetDocs (fail-close helper)', () => {
  // Case 1: all docs found:true, no errors → all IDs returned
  it('returns all IDs when all docs are found:true with no errors', () => {
    const docs: MgetDoc[] = [
      { _id: 'page1', found: true },
      { _id: 'page2', found: true },
      { _id: 'page3', found: true },
    ];
    expect(filterMgetDocs(docs)).toEqual(['page1', 'page2', 'page3']);
  });

  // Case 2: some found:false → only found:true docs included
  it('excludes docs where found=false', () => {
    const docs: MgetDoc[] = [
      { _id: 'page1', found: true },
      { _id: 'page2', found: false }, // deleted / unauthorized
      { _id: 'page3', found: true },
    ];
    expect(filterMgetDocs(docs)).toEqual(['page1', 'page3']);
  });

  // Case 3: docs with error field → only success docs (no error) included
  it('excludes docs with an error field even when found=true', () => {
    const docs: MgetDoc[] = [
      { _id: 'page1', found: true }, // success
      { _id: 'page2', found: false, error: { type: 'shard_failure' } }, // shard error
      { _id: 'page3', found: true, error: { type: 'routing_error' } }, // error wins over found:true
    ];
    // Only page1 passes: found===true AND no error
    expect(filterMgetDocs(docs)).toEqual(['page1']);
  });

  it('returns empty array when all docs fail', () => {
    const docs: MgetDoc[] = [
      { _id: 'page1', found: false },
      { _id: 'page2', found: false, error: { type: 'shard_failure' } },
    ];
    expect(filterMgetDocs(docs)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Task 7.2: resolveSecondary
// ---------------------------------------------------------------------------

describe('AttachmentSearchResultAggregator.resolveSecondary', () => {
  let pageSearchFn: ReturnType<typeof vi.fn>;
  let searchAttachments: ReturnType<typeof vi.fn>;
  let mgetPages: ReturnType<typeof vi.fn>;
  let attachmentClient: AttachmentIndexClient;

  beforeEach(() => {
    pageSearchFn = vi.fn();
    searchAttachments = vi.fn();
    mgetPages = vi.fn();
    attachmentClient = { searchAttachments, mgetPages };
  });

  // -------------------------------------------------------------------------
  // facet=attachments: primary already did mget — no-op
  // -------------------------------------------------------------------------
  describe('facet=attachments', () => {
    it('returns empty enrichments without calling mget or search', async () => {
      const agg = makeAggregator(pageSearchFn, attachmentClient);
      const result = await agg.resolveSecondary('keyword', {
        facet: 'attachments',
        primaryIds: ['page1', 'page2'],
      });

      expect(result.facet).toBe('attachments');
      expect(result.enrichments).toEqual({});
      expect(mgetPages).not.toHaveBeenCalled();
      expect(searchAttachments).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // facet=all: enrichment with attachment hits grouped by pageId
  // -------------------------------------------------------------------------
  describe('facet=all', () => {
    it('returns attachment hits grouped by pageId', async () => {
      // mget confirms both pages still exist
      mgetPages.mockResolvedValue(
        makeMgetResponse([
          { id: 'page1', found: true },
          { id: 'page2', found: true },
        ]),
      );
      // Attachment search returns two hits across two pages
      searchAttachments.mockResolvedValue(
        makeAttachmentResponse([
          { pageId: 'page1', attachmentId: 'att1' },
          { pageId: 'page2', attachmentId: 'att2' },
          { pageId: 'page1', attachmentId: 'att3' }, // second hit for page1
        ]),
      );

      const agg = makeAggregator(pageSearchFn, attachmentClient);
      const result = await agg.resolveSecondary('keyword', {
        facet: 'all',
        primaryIds: ['page1', 'page2'],
      });

      expect(result.facet).toBe('all');
      expect(result.enrichments['page1']?.attachmentHits).toHaveLength(2);
      expect(
        result.enrichments['page1']?.attachmentHits?.[0].attachmentId,
      ).toBe('att1');
      expect(
        result.enrichments['page1']?.attachmentHits?.[1].attachmentId,
      ).toBe('att3');
      expect(result.enrichments['page2']?.attachmentHits).toHaveLength(1);
      expect(
        result.enrichments['page2']?.attachmentHits?.[0].attachmentId,
      ).toBe('att2');
    });

    it('drops pages that disappeared since primary (time-lag defense, found:false)', async () => {
      // page2 has disappeared between primary and secondary
      mgetPages.mockResolvedValue(
        makeMgetResponse([
          { id: 'page1', found: true },
          { id: 'page2', found: false }, // disappeared
        ]),
      );
      searchAttachments.mockResolvedValue(
        makeAttachmentResponse([{ pageId: 'page1', attachmentId: 'att1' }]),
      );

      const agg = makeAggregator(pageSearchFn, attachmentClient);
      const result = await agg.resolveSecondary('keyword', {
        facet: 'all',
        primaryIds: ['page1', 'page2'],
      });

      // Only page1's hits should appear
      expect(result.enrichments['page1']?.attachmentHits).toHaveLength(1);
      expect(result.enrichments['page2']).toBeUndefined();
    });

    it('returns empty enrichments when all primary pages disappeared', async () => {
      mgetPages.mockResolvedValue(
        makeMgetResponse([
          { id: 'page1', found: false },
          { id: 'page2', found: false },
        ]),
      );

      const agg = makeAggregator(pageSearchFn, attachmentClient);
      const result = await agg.resolveSecondary('keyword', {
        facet: 'all',
        primaryIds: ['page1', 'page2'],
      });

      expect(result.enrichments).toEqual({});
      // attachment search should NOT be called since no valid IDs remain
      expect(searchAttachments).not.toHaveBeenCalled();
    });

    it('throws RangeError when primaryIds.length > DEFAULT_PAGE_SIZE (20)', async () => {
      const tooManyIds = Array.from({ length: 21 }, (_, i) => `page${i}`);
      const agg = makeAggregator(pageSearchFn, attachmentClient);

      await expect(
        agg.resolveSecondary('keyword', {
          facet: 'all',
          primaryIds: tooManyIds,
        }),
      ).rejects.toThrow(RangeError);
    });

    it('returns empty enrichments on secondary timeout (500ms safety net)', async () => {
      // mget resolves slowly — exceeds 500ms secondary timeout
      mgetPages.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve(makeMgetResponse([{ id: 'page1', found: true }])),
              200,
            ),
          ),
      );

      // Use a very short timeout to trigger the safety net
      const agg = makeAggregator(pageSearchFn, attachmentClient, 800);
      // We need to override SECONDARY_TIMEOUT_MS — use a wrapper that we test
      // indirectly by overriding with a tiny timeout on the internal helper.
      // We achieve this by testing at the public API level with a tiny aggregator timeout
      // and a slow mget: for secondary we always use 500ms, so we use fake timers instead.

      // Alternative: test using a very slow mget and a fresh aggregator with vi.useFakeTimers
      vi.useFakeTimers();
      const fastAgg = makeAggregator(pageSearchFn, attachmentClient, 800);

      const resultPromise = fastAgg.resolveSecondary('keyword', {
        facet: 'all',
        primaryIds: ['page1'],
      });

      // Advance past the 500ms secondary timeout
      vi.advanceTimersByTime(600);
      vi.useRealTimers();

      const result = await resultPromise;
      expect(result.facet).toBe('all');
      expect(result.enrichments).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  // Task 7.3: fail-close mget applied to resolveSecondary
  // -------------------------------------------------------------------------
  describe('fail-close mget in resolveSecondary (task 7.3)', () => {
    // Case 1: all found:true → all included
    it('includes all pages when all mget docs are found:true', async () => {
      mgetPages.mockResolvedValue(
        makeMgetResponse([
          { id: 'page1', found: true },
          { id: 'page2', found: true },
        ]),
      );
      searchAttachments.mockResolvedValue(
        makeAttachmentResponse([
          { pageId: 'page1', attachmentId: 'att1' },
          { pageId: 'page2', attachmentId: 'att2' },
        ]),
      );

      const agg = makeAggregator(pageSearchFn, attachmentClient);
      const result = await agg.resolveSecondary('keyword', {
        facet: 'all',
        primaryIds: ['page1', 'page2'],
      });

      expect(result.enrichments['page1']?.attachmentHits).toHaveLength(1);
      expect(result.enrichments['page2']?.attachmentHits).toHaveLength(1);
    });

    // Case 2: some found:false → only found:true docs included
    it('excludes pages with found:false from enrichments (fail-close)', async () => {
      mgetPages.mockResolvedValue(
        makeMgetResponse([
          { id: 'page1', found: true },
          { id: 'page2', found: false }, // excluded by fail-close
        ]),
      );
      searchAttachments.mockResolvedValue(
        makeAttachmentResponse([{ pageId: 'page1', attachmentId: 'att1' }]),
      );

      const agg = makeAggregator(pageSearchFn, attachmentClient);
      const result = await agg.resolveSecondary('keyword', {
        facet: 'all',
        primaryIds: ['page1', 'page2'],
      });

      expect(result.enrichments['page1']?.attachmentHits).toHaveLength(1);
      expect(result.enrichments['page2']).toBeUndefined(); // fail-close: not included
    });

    // Case 3: docs with error field → only success docs (no error) included
    it('excludes pages with error field from enrichments (fail-close)', async () => {
      mgetPages.mockResolvedValue(
        makeMgetResponse([
          { id: 'page1', found: true }, // success
          { id: 'page2', found: false, error: { type: 'shard_failure' } }, // error: excluded
          { id: 'page3', found: true, error: { type: 'routing_error' } }, // error field present: excluded
        ]),
      );
      searchAttachments.mockResolvedValue(
        makeAttachmentResponse([{ pageId: 'page1', attachmentId: 'att1' }]),
      );

      const agg = makeAggregator(pageSearchFn, attachmentClient);
      const result = await agg.resolveSecondary('keyword', {
        facet: 'all',
        primaryIds: ['page1', 'page2', 'page3'],
      });

      // Only page1 passes fail-close; page2 and page3 excluded
      expect(result.enrichments['page1']?.attachmentHits).toHaveLength(1);
      expect(result.enrichments['page2']).toBeUndefined();
      expect(result.enrichments['page3']).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Task 7.3: fail-close mget applied to searchPrimary (facet=attachments)
  // -------------------------------------------------------------------------
  describe('fail-close mget in searchPrimary facet=attachments (task 7.3)', () => {
    // Case 1: all found:true → all included
    it('includes all pages when all mget docs are found:true', async () => {
      searchAttachments.mockResolvedValue(
        makeAttachmentResponse([
          { pageId: 'page1', attachmentId: 'att1' },
          { pageId: 'page2', attachmentId: 'att2' },
        ]),
      );
      mgetPages.mockResolvedValue(
        makeMgetResponse([
          { id: 'page1', found: true },
          { id: 'page2', found: true },
        ]),
      );

      const agg = makeAggregator(pageSearchFn, attachmentClient);
      const result = await agg.searchPrimary('keyword', {
        facet: 'attachments',
        from: 0,
        size: 20,
      });

      expect(result.items).toHaveLength(2);
      expect(result.items.map((i) => i.data._id).sort()).toEqual([
        'page1',
        'page2',
      ]);
    });

    // Case 2: some found:false → only found:true docs included
    it('excludes pages with found:false (fail-close, not fail-open)', async () => {
      searchAttachments.mockResolvedValue(
        makeAttachmentResponse([
          { pageId: 'page1', attachmentId: 'att1' },
          { pageId: 'page2', attachmentId: 'att2' },
        ]),
      );
      mgetPages.mockResolvedValue(
        makeMgetResponse([
          { id: 'page1', found: true },
          { id: 'page2', found: false }, // not authorized / deleted
        ]),
      );

      const agg = makeAggregator(pageSearchFn, attachmentClient);
      const result = await agg.searchPrimary('keyword', {
        facet: 'attachments',
        from: 0,
        size: 20,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].data._id).toBe('page1');
    });

    // Case 3: docs with errors array → only success docs included
    it('excludes pages with error field in mget response (fail-close)', async () => {
      searchAttachments.mockResolvedValue(
        makeAttachmentResponse([
          { pageId: 'page1', attachmentId: 'att1' },
          { pageId: 'page2', attachmentId: 'att2' },
          { pageId: 'page3', attachmentId: 'att3' },
        ]),
      );
      mgetPages.mockResolvedValue(
        makeMgetResponse([
          { id: 'page1', found: true }, // success
          { id: 'page2', found: false, error: { type: 'shard_failure' } }, // error: excluded
          { id: 'page3', found: true, error: { type: 'routing_error' } }, // error field present: excluded
        ]),
      );

      const agg = makeAggregator(pageSearchFn, attachmentClient);
      const result = await agg.searchPrimary('keyword', {
        facet: 'attachments',
        from: 0,
        size: 20,
      });

      // Only page1 passes fail-close
      expect(result.items).toHaveLength(1);
      expect(result.items[0].data._id).toBe('page1');
    });
  });
});
