import type { IUserHasId } from '@growi/core';
import { type MockProxy, mock } from 'vitest-mock-extended';

import type { ISearchResult, ISearchResultData } from '~/interfaces/search';

import {
  type AttachmentIndexClient,
  type AttachmentSearchResponse,
  AttachmentSearchResultAggregator,
  type PageSearchFn,
} from './attachment-search-result-aggregator';
import type {
  AccessiblePage,
  AttachmentSearchViewer,
} from './search-accessible-pages';

const { loggerWarn } = vi.hoisted(() => ({ loggerWarn: vi.fn() }));
vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: loggerWarn,
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const viewer: AttachmentSearchViewer = {
  user: mock<IUserHasId>({ _id: 'viewer-id' }),
  userGroups: [],
};
const guest: AttachmentSearchViewer = { user: null, userGroups: null };

const makePageSearchResult = (
  pageIds: string[],
): ISearchResult<ISearchResultData> => ({
  meta: { total: pageIds.length, took: 5, hitsCount: pageIds.length },
  data: pageIds.map((id) => ({
    _id: id,
    _score: 1.0,
    _source: { path: `/page/${id}` },
    _highlight: { body: [`snippet for ${id}`], path: [`/page/${id}`] },
  })),
});

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
      highlight: { content: ['<em>matching</em> content'] },
    })),
  },
});

const accessible = (...pageIds: string[]): AccessiblePage[] =>
  pageIds.map((pageId) => ({ pageId, path: `/${pageId}`, updatedAt: null }));

const delayed = <T>(value: T, ms: number): Promise<T> =>
  new Promise((resolve) => {
    setTimeout(() => resolve(value), ms);
  });

const attachmentIdsOf = (
  items: Awaited<
    ReturnType<AttachmentSearchResultAggregator['searchPrimary']>
  >['items'],
): Record<string, string[]> =>
  Object.fromEntries(
    items
      .filter((i) => i.meta?.attachmentHits != null)
      .map((i) => [
        i.data._id,
        (i.meta?.attachmentHits ?? []).map((h) => h.attachmentId),
      ]),
  );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AttachmentSearchResultAggregator', () => {
  let pageSearchFn: ReturnType<typeof vi.fn<PageSearchFn>>;
  let client: MockProxy<AttachmentIndexClient>;

  const makeAggregator = (timeoutMs = 800) =>
    new AttachmentSearchResultAggregator(pageSearchFn, client, timeoutMs);

  beforeEach(() => {
    pageSearchFn = vi.fn<PageSearchFn>();
    client = mock<AttachmentIndexClient>();
  });

  describe('searchPrimary facet=pages', () => {
    it('runs only the page search for the viewer and never touches attachments', async () => {
      pageSearchFn.mockResolvedValue(makePageSearchResult(['page1', 'page2']));

      const result = await makeAggregator().searchPrimary('keyword', viewer, {
        facet: 'pages',
        from: 0,
        size: 20,
      });

      expect(pageSearchFn).toHaveBeenCalledWith('keyword', viewer, {
        from: 0,
        size: 20,
      });
      expect(client.searchAttachments).not.toHaveBeenCalled();
      expect(client.searchAccessiblePages).not.toHaveBeenCalled();
      expect(result.primarySlot).toBe('pages');
      expect(result.items.map((i) => i.data._id)).toEqual(['page1', 'page2']);
      expect(result.meta.total).toBe(2);
    });
  });

  describe('searchPrimary facet=all, from=0', () => {
    it('embeds attachment hits only for primary pages the viewer may see', async () => {
      pageSearchFn.mockResolvedValue(
        makePageSearchResult(['page1', 'page2', 'listed-but-hidden']),
      );
      client.searchAttachments.mockResolvedValue(
        makeAttachmentResponse([
          { pageId: 'page1', attachmentId: 'att1' },
          { pageId: 'listed-but-hidden', attachmentId: 'att-hidden' },
          { pageId: 'not-in-primary', attachmentId: 'att-other' },
        ]),
      );
      client.searchAccessiblePages.mockResolvedValue(accessible('page1'));

      const result = await makeAggregator().searchPrimary('keyword', viewer, {
        facet: 'all',
        from: 0,
        size: 20,
      });

      expect(client.searchAccessiblePages).toHaveBeenCalledWith(
        ['page1', 'listed-but-hidden'],
        viewer,
      );
      expect(result.items.map((i) => i.data._id)).toEqual([
        'page1',
        'page2',
        'listed-but-hidden',
      ]);
      expect(attachmentIdsOf(result.items)).toEqual({ page1: ['att1'] });
      expect(result.facet).toBe('all');
      expect(result.primarySlot).toBe('pages');
    });

    it('keeps the page results but drops every attachment hit when the permission check fails', async () => {
      pageSearchFn.mockResolvedValue(makePageSearchResult(['page1']));
      client.searchAttachments.mockResolvedValue(
        makeAttachmentResponse([{ pageId: 'page1', attachmentId: 'att1' }]),
      );
      client.searchAccessiblePages.mockRejectedValue(new Error('es down'));

      const result = await makeAggregator().searchPrimary('keyword', viewer, {
        facet: 'all',
        from: 0,
        size: 20,
      });

      expect(result.items.map((i) => i.data._id)).toEqual(['page1']);
      expect(attachmentIdsOf(result.items)).toEqual({});
    });

    it('degrades to a pages-only result when the primary searches exceed the timeout', async () => {
      pageSearchFn
        .mockImplementationOnce(() =>
          delayed(makePageSearchResult(['page1']), 200),
        )
        .mockResolvedValueOnce(makePageSearchResult(['page2']));
      client.searchAttachments.mockImplementation(() =>
        delayed(makeAttachmentResponse([]), 200),
      );

      const result = await makeAggregator(50).searchPrimary('keyword', viewer, {
        facet: 'all',
        from: 0,
        size: 20,
      });

      expect(result.primarySlot).toBe('pages');
      expect(result.items.map((i) => i.data._id)).toEqual(['page2']);
      expect(attachmentIdsOf(result.items)).toEqual({});
      expect(pageSearchFn).toHaveBeenLastCalledWith('keyword', viewer, {
        from: 0,
        size: 20,
      });
    });
  });

  describe('searchPrimary facet=all, from>0', () => {
    it('runs only the page search', async () => {
      pageSearchFn.mockResolvedValue(makePageSearchResult(['page3']));

      const result = await makeAggregator().searchPrimary('keyword', viewer, {
        facet: 'all',
        from: 20,
        size: 20,
      });

      expect(client.searchAttachments).not.toHaveBeenCalled();
      expect(result.items.map((i) => i.data._id)).toEqual(['page3']);
      expect(attachmentIdsOf(result.items)).toEqual({});
    });
  });

  describe('searchPrimary facet=attachments', () => {
    it('returns hits only for pages the permission check returned, deduplicating the ids it asks about', async () => {
      client.searchAttachments.mockResolvedValue(
        makeAttachmentResponse([
          { pageId: 'page1', attachmentId: 'att1' },
          { pageId: 'page1', attachmentId: 'att2' },
          { pageId: 'hidden', attachmentId: 'att3' },
          { pageId: 'deleted', attachmentId: 'att4' },
        ]),
      );
      client.searchAccessiblePages.mockResolvedValue(accessible('page1'));

      const result = await makeAggregator().searchPrimary('keyword', guest, {
        facet: 'attachments',
        from: 0,
        size: 20,
      });

      expect(client.searchAccessiblePages).toHaveBeenCalledWith(
        ['page1', 'hidden', 'deleted'],
        guest,
      );
      expect(attachmentIdsOf(result.items)).toEqual({
        page1: ['att1', 'att2'],
      });
      expect(result.primarySlot).toBe('attachments');
      expect(pageSearchFn).not.toHaveBeenCalled();
    });

    it('does not run the permission check when nothing matched', async () => {
      client.searchAttachments.mockResolvedValue(makeAttachmentResponse([]));

      const result = await makeAggregator().searchPrimary('keyword', viewer, {
        facet: 'attachments',
        from: 0,
        size: 20,
      });

      expect(client.searchAccessiblePages).not.toHaveBeenCalled();
      expect(result.items).toEqual([]);
      expect(result.meta.primaryResultIncomplete).toBe(false);
    });

    it('reports primaryResultIncomplete when drops leave fewer than size items after a full over-fetch', async () => {
      const hits = Array.from({ length: 3 }, (_, i) => ({
        pageId: `page${i}`,
        attachmentId: `att${i}`,
      }));
      client.searchAttachments.mockResolvedValue(makeAttachmentResponse(hits));
      client.searchAccessiblePages.mockResolvedValue(accessible('page0'));

      const result = await makeAggregator().searchPrimary('keyword', viewer, {
        facet: 'attachments',
        from: 0,
        size: 2,
      });

      expect(result.items).toHaveLength(1);
      expect(result.meta.primaryResultIncomplete).toBe(true);
    });

    it('builds snippet segments from the highlight fragment', async () => {
      const response = makeAttachmentResponse([
        { pageId: 'page1', attachmentId: 'att1' },
      ]);
      response.hits.hits[0].highlight = {
        content: ['hello <em>world</em> foo'],
      };
      client.searchAttachments.mockResolvedValue(response);
      client.searchAccessiblePages.mockResolvedValue(accessible('page1'));

      const result = await makeAggregator().searchPrimary('keyword', viewer, {
        facet: 'attachments',
        from: 0,
        size: 20,
      });

      expect(result.items[0].meta?.attachmentHits?.[0].snippets).toEqual([
        { text: 'hello ', highlighted: false },
        { text: 'world', highlighted: true },
        { text: ' foo', highlighted: false },
      ]);
    });

    it('returns empty + incomplete when the attachment search times out', async () => {
      client.searchAttachments.mockImplementation(() =>
        delayed(
          makeAttachmentResponse([{ pageId: 'p1', attachmentId: 'a1' }]),
          200,
        ),
      );

      const result = await makeAggregator(50).searchPrimary('keyword', viewer, {
        facet: 'attachments',
        from: 0,
        size: 20,
      });

      expect(result.items).toEqual([]);
      expect(result.meta.primaryResultIncomplete).toBe(true);
    });

    describe('fail-close when the permission check does not succeed', () => {
      beforeEach(() => {
        client.searchAttachments.mockResolvedValue(
          makeAttachmentResponse([{ pageId: 'page1', attachmentId: 'att1' }]),
        );
      });

      it('drops every hit when the permission check throws, logging it as an error', async () => {
        client.searchAccessiblePages.mockRejectedValue(
          new Error('The page index search had 1 failed shard(s)'),
        );

        const result = await makeAggregator().searchPrimary('keyword', viewer, {
          facet: 'attachments',
          from: 0,
          size: 20,
        });

        expect(result.items).toEqual([]);
        expect(result.meta.primaryResultIncomplete).toBe(true);
        expect(loggerWarn).toHaveBeenCalledWith(
          expect.objectContaining({ failure: 'error' }),
          expect.stringContaining('permission check failed'),
        );
      });

      it('drops every hit when the permission check times out, logging it as a timeout', async () => {
        client.searchAccessiblePages.mockImplementation(() =>
          delayed(accessible('page1'), 200),
        );

        const result = await makeAggregator(50).searchPrimary(
          'keyword',
          viewer,
          { facet: 'attachments', from: 0, size: 20 },
        );

        expect(result.items).toEqual([]);
        expect(loggerWarn).toHaveBeenCalledWith(
          expect.objectContaining({ failure: 'timeout' }),
          expect.stringContaining('permission check failed'),
        );
      });

      it('keeps only the pages that a partial answer returned', async () => {
        client.searchAttachments.mockResolvedValue(
          makeAttachmentResponse([
            { pageId: 'page1', attachmentId: 'att1' },
            { pageId: 'page2', attachmentId: 'att2' },
          ]),
        );
        client.searchAccessiblePages.mockResolvedValue(accessible('page2'));

        const result = await makeAggregator().searchPrimary('keyword', viewer, {
          facet: 'attachments',
          from: 0,
          size: 20,
        });

        expect(attachmentIdsOf(result.items)).toEqual({ page2: ['att2'] });
      });
    });
  });

  describe('resolveSecondary', () => {
    it('is a no-op for facet=attachments', async () => {
      const result = await makeAggregator().resolveSecondary('kw', viewer, {
        facet: 'attachments',
        primaryIds: ['page1'],
      });

      expect(result).toEqual({ facet: 'attachments', enrichments: {} });
      expect(client.searchAccessiblePages).not.toHaveBeenCalled();
      expect(client.searchAttachments).not.toHaveBeenCalled();
    });

    it('re-checks the client-supplied ids for the viewer and searches attachments only for the visible ones', async () => {
      client.searchAccessiblePages.mockResolvedValue(accessible('page1'));
      client.searchAttachments.mockResolvedValue(
        makeAttachmentResponse([
          { pageId: 'page1', attachmentId: 'att1' },
          { pageId: 'page1', attachmentId: 'att2' },
        ]),
      );

      const result = await makeAggregator().resolveSecondary('kw', guest, {
        facet: 'all',
        primaryIds: ['page1', 'forbidden', 'page1', 'no-such-page'],
      });

      expect(client.searchAccessiblePages).toHaveBeenCalledWith(
        ['page1', 'forbidden', 'no-such-page'],
        guest,
      );
      const searchBody = JSON.stringify(
        client.searchAttachments.mock.calls[0][0],
      );
      expect(searchBody).toContain('"pageId":["page1"]');
      expect(
        result.enrichments.page1?.attachmentHits?.map((h) => h.attachmentId),
      ).toEqual(['att1', 'att2']);
      expect(Object.keys(result.enrichments)).toEqual(['page1']);
    });

    it('drops a hit for a page the permission check did not return even if the attachment search returns it', async () => {
      client.searchAccessiblePages.mockResolvedValue(accessible('page1'));
      client.searchAttachments.mockResolvedValue(
        makeAttachmentResponse([
          { pageId: 'page1', attachmentId: 'att1' },
          { pageId: 'forbidden', attachmentId: 'att-x' },
        ]),
      );

      const result = await makeAggregator().resolveSecondary('kw', viewer, {
        facet: 'all',
        primaryIds: ['page1', 'forbidden'],
      });

      expect(Object.keys(result.enrichments)).toEqual(['page1']);
    });

    it('returns no enrichments and skips the attachment search when no id is visible', async () => {
      client.searchAccessiblePages.mockResolvedValue([]);

      const result = await makeAggregator().resolveSecondary('kw', viewer, {
        facet: 'all',
        primaryIds: ['forbidden'],
      });

      expect(result.enrichments).toEqual({});
      expect(client.searchAttachments).not.toHaveBeenCalled();
    });

    it('returns no enrichments when the permission check throws', async () => {
      client.searchAccessiblePages.mockRejectedValue(new Error('es down'));
      client.searchAttachments.mockResolvedValue(
        makeAttachmentResponse([{ pageId: 'page1', attachmentId: 'att1' }]),
      );

      const result = await makeAggregator().resolveSecondary('kw', viewer, {
        facet: 'all',
        primaryIds: ['page1'],
      });

      expect(result).toEqual({ facet: 'all', enrichments: {} });
      expect(client.searchAttachments).not.toHaveBeenCalled();
    });

    it('returns no enrichments when the secondary phase exceeds 500ms', async () => {
      client.searchAccessiblePages.mockImplementation(() =>
        delayed(accessible('page1'), 700),
      );

      const result = await makeAggregator().resolveSecondary('kw', viewer, {
        facet: 'all',
        primaryIds: ['page1'],
      });

      expect(result).toEqual({ facet: 'all', enrichments: {} });
      expect(loggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ failure: 'timeout' }),
        expect.any(String),
      );
    });

    it('throws RangeError for more than 20 distinct ids, counting duplicates once', async () => {
      const many = Array.from({ length: 21 }, (_, i) => `page${i}`);
      client.searchAccessiblePages.mockResolvedValue([]);

      await expect(
        makeAggregator().resolveSecondary('kw', viewer, {
          facet: 'all',
          primaryIds: many,
        }),
      ).rejects.toThrow(RangeError);
      await expect(
        makeAggregator().resolveSecondary('kw', viewer, {
          facet: 'all',
          primaryIds: [...many.slice(0, 20), 'page0'],
        }),
      ).resolves.toEqual({ facet: 'all', enrichments: {} });
    });
  });
});
