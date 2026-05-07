/**
 * Unit tests for AttachmentSearchResultAggregator.searchPrimary
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
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AttachmentIndexClient,
  AttachmentSearchResponse,
  MgetPagesResponse,
  PageSearchFn,
} from './attachment-search-result-aggregator';
import { AttachmentSearchResultAggregator } from './attachment-search-result-aggregator';

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
  docs: Array<{ id: string; found: boolean }>,
): MgetPagesResponse => ({
  docs: docs.map(({ id, found }) => ({ _id: id, found })),
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
