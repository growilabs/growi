import type { IUserHasId } from '@growi/core';
import mongoose from 'mongoose';
import { type MockProxy, mock } from 'vitest-mock-extended';

import type {
  IFormattedSearchResult,
  IPageWithSearchMeta,
} from '~/interfaces/search';
import type { QueryTerms } from '~/server/interfaces/search';

import {
  type AttachmentEsHit,
  type AttachmentIndexClient,
  type AttachmentSearchInput,
  type AttachmentSearchResponse,
  AttachmentSearchResultAggregator,
  type IPrimarySearchResult,
  type PageSearchFn,
} from './attachment-search-result-aggregator';
import { WINDOW_CAP } from './collect-visible-attachment-hits';
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

const EMPTY_TERMS: QueryTerms = {
  match: [],
  not_match: [],
  phrase: [],
  not_phrase: [],
  prefix: [],
  not_prefix: [],
  tag: [],
  not_tag: [],
  author: [],
  not_author: [],
  editor: [],
  not_editor: [],
  group: [],
  not_group: [],
};

const inputFor = (
  who: AttachmentSearchViewer,
  terms: Partial<QueryTerms> = { match: ['keyword'] },
): AttachmentSearchInput => ({
  queryString: 'keyword',
  terms: { ...EMPTY_TERMS, ...terms },
  resolvedFilterData: { groupIds: [], notGroupIds: [] },
  viewer: who,
});

const NO_FILTER = {
  terms: {
    prefix: [],
    not_prefix: [],
    tag: [],
    not_tag: [],
    author: [],
    not_author: [],
    editor: [],
    not_editor: [],
    group: [],
    not_group: [],
  },
  resolvedFilterData: { groupIds: [], notGroupIds: [] },
};

// Formatted page items carry Mongo ids (ObjectId), as formatSearchResult returns them.
const objectIds: Record<string, mongoose.Types.ObjectId> = {};
const oid = (name: string): mongoose.Types.ObjectId => {
  objectIds[name] ??= new mongoose.Types.ObjectId();
  return objectIds[name];
};
const idOf = (name: string): string => oid(name).toString();
const nameOf = (id: unknown): string =>
  Object.entries(objectIds).find(([, o]) => o.toString() === String(id))?.[0] ??
  String(id);

const makePageSearchResult = (names: string[]): IFormattedSearchResult => ({
  meta: { total: 42, took: 5, hitsCount: names.length },
  data: names.map(
    (name): IPageWithSearchMeta => ({
      data: { _id: oid(name), path: `/${name}` } as never,
      meta: {
        bookmarkCount: 0,
        elasticSearchResult: {
          snippet: `formatted snippet of ${name}`,
          highlightedPath: null,
        },
      },
    }),
  ),
});

const esHit = (pageId: string, attachmentId: string): AttachmentEsHit => ({
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
});

const makeAttachmentResponse = (
  hits: Array<{ pageId: string; attachmentId: string }>,
): AttachmentSearchResponse => ({
  hits: {
    hits: hits.map(({ pageId, attachmentId }) => esHit(pageId, attachmentId)),
  },
});

// Serves the requested from/size slice of the hits, like Elasticsearch.
const serveHits =
  (hits: AttachmentEsHit[]) =>
  async (body: Record<string, unknown>): Promise<AttachmentSearchResponse> => {
    const from = Number(body.from ?? 0);
    const size = Number(body.size ?? 20);
    return { hits: { hits: hits.slice(from, from + size) } };
  };

const accessible = (...pageIds: string[]): AccessiblePage[] =>
  pageIds.map((pageId) => ({ pageId, path: `/${pageId}`, updatedAt: null }));

const accessibleAmong =
  (visible: (pageId: string) => boolean) =>
  async (pageIds: readonly string[]): Promise<AccessiblePage[]> =>
    accessible(...pageIds.filter(visible));

const delayed = <T>(value: T, ms: number): Promise<T> =>
  new Promise((resolve) => {
    setTimeout(() => resolve(value), ms);
  });

const attachmentIdsOf = (
  items: IPageWithSearchMeta[],
): Record<string, string[]> =>
  Object.fromEntries(
    items
      .filter((i) => i.meta?.attachmentHits != null)
      .map((i) => [
        nameOf(i.data._id),
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
    it('returns the formatted page search result as is and never touches attachments', async () => {
      const pageResult = makePageSearchResult(['page1', 'page2']);
      pageSearchFn.mockResolvedValue(pageResult);
      const input = inputFor(viewer);

      const result = await makeAggregator().searchPrimary(input, {
        facet: 'pages',
        from: 0,
        size: 20,
      });

      expect(pageSearchFn).toHaveBeenCalledWith(input, { from: 0, size: 20 });
      expect(client.searchAttachments).not.toHaveBeenCalled();
      expect(client.searchAccessiblePages).not.toHaveBeenCalled();
      expect(result.primarySlot).toBe('pages');
      expect(result.items).toEqual(pageResult.data);
      expect(result.meta.total).toBe(42);
    });
  });

  describe('searchPrimary facet=all, from=0', () => {
    it('embeds attachment hits only for primary pages the viewer may see, keeping the formatted page items', async () => {
      const pageResult = makePageSearchResult([
        'page1',
        'page2',
        'listed-but-hidden',
      ]);
      pageSearchFn.mockResolvedValue(pageResult);
      client.searchAttachments.mockResolvedValue(
        makeAttachmentResponse([
          { pageId: idOf('page1'), attachmentId: 'att1' },
          { pageId: idOf('listed-but-hidden'), attachmentId: 'att-hidden' },
          { pageId: idOf('not-in-primary'), attachmentId: 'att-other' },
        ]),
      );
      client.searchAccessiblePages.mockResolvedValue(accessible(idOf('page1')));

      const result = await makeAggregator().searchPrimary(inputFor(viewer), {
        facet: 'all',
        from: 0,
        size: 20,
      });

      expect(client.searchAccessiblePages).toHaveBeenCalledWith(
        [idOf('page1'), idOf('listed-but-hidden')],
        viewer,
        NO_FILTER,
      );
      expect(result.items.map((i) => i.data)).toEqual(
        pageResult.data.map((i) => i.data),
      );
      expect(result.items.map((i) => i.meta?.elasticSearchResult)).toEqual(
        pageResult.data.map((i) => i.meta?.elasticSearchResult),
      );
      expect(attachmentIdsOf(result.items)).toEqual({ page1: ['att1'] });
      expect(result.meta.total).toBe(42);
      expect(result.facet).toBe('all');
      expect(result.primarySlot).toBe('pages');
    });

    it('matches attachment content with the keyword terms only and checks the operators on the parent page', async () => {
      pageSearchFn.mockResolvedValue(makePageSearchResult(['page1']));
      client.searchAttachments.mockResolvedValue(
        makeAttachmentResponse([{ pageId: idOf('page1'), attachmentId: 'a' }]),
      );
      client.searchAccessiblePages.mockResolvedValue(accessible(idOf('page1')));
      const input = inputFor(viewer, {
        match: ['minutes'],
        author: ['jim'],
        not_prefix: ['/user'],
      });

      await makeAggregator().searchPrimary(input, {
        facet: 'all',
        from: 0,
        size: 20,
      });

      const body = JSON.stringify(client.searchAttachments.mock.calls[0][0]);
      expect(body).toContain('"query":"minutes"');
      expect(body).not.toContain('jim');
      expect(body).not.toContain('/user');
      expect(client.searchAccessiblePages.mock.calls[0][2]).toEqual({
        terms: { ...NO_FILTER.terms, author: ['jim'], not_prefix: ['/user'] },
        resolvedFilterData: input.resolvedFilterData,
      });
    });

    it('does not search attachments for an operator-only query', async () => {
      pageSearchFn.mockResolvedValue(makePageSearchResult(['page1']));

      const result = await makeAggregator().searchPrimary(
        inputFor(viewer, { author: ['jim'] }),
        { facet: 'all', from: 0, size: 20 },
      );

      expect(client.searchAttachments).not.toHaveBeenCalled();
      expect(result.items.map((i) => nameOf(i.data._id))).toEqual(['page1']);
      expect(attachmentIdsOf(result.items)).toEqual({});
    });

    it('keeps the page results but drops every attachment hit when the permission check fails', async () => {
      pageSearchFn.mockResolvedValue(makePageSearchResult(['page1']));
      client.searchAttachments.mockResolvedValue(
        makeAttachmentResponse([{ pageId: idOf('page1'), attachmentId: 'a' }]),
      );
      client.searchAccessiblePages.mockRejectedValue(new Error('es down'));

      const result = await makeAggregator().searchPrimary(inputFor(viewer), {
        facet: 'all',
        from: 0,
        size: 20,
      });

      expect(result.items.map((i) => nameOf(i.data._id))).toEqual(['page1']);
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
      const input = inputFor(viewer);

      const result = await makeAggregator(50).searchPrimary(input, {
        facet: 'all',
        from: 0,
        size: 20,
      });

      expect(result.primarySlot).toBe('pages');
      expect(result.items.map((i) => nameOf(i.data._id))).toEqual(['page2']);
      expect(attachmentIdsOf(result.items)).toEqual({});
      expect(pageSearchFn).toHaveBeenLastCalledWith(input, {
        from: 0,
        size: 20,
      });
    });
  });

  describe('searchPrimary facet=all, from>0', () => {
    it('runs only the page search', async () => {
      pageSearchFn.mockResolvedValue(makePageSearchResult(['page3']));

      const result = await makeAggregator().searchPrimary(inputFor(viewer), {
        facet: 'all',
        from: 20,
        size: 20,
      });

      expect(client.searchAttachments).not.toHaveBeenCalled();
      expect(result.items.map((i) => nameOf(i.data._id))).toEqual(['page3']);
      expect(attachmentIdsOf(result.items)).toEqual({});
    });
  });

  describe('searchPrimary facet=attachments', () => {
    const primary = (
      input: AttachmentSearchInput,
      from = 0,
      size = 20,
      timeoutMs?: number,
    ) =>
      makeAggregator(timeoutMs).searchPrimary(input, {
        facet: 'attachments',
        from,
        size,
      });

    it('returns hits only for pages the permission check returned, deduplicating the ids it asks about', async () => {
      client.searchAttachments.mockImplementation(
        serveHits([
          esHit('page1', 'att1'),
          esHit('page1', 'att2'),
          esHit('hidden', 'att3'),
          esHit('deleted', 'att4'),
        ]),
      );
      client.searchAccessiblePages.mockResolvedValue(accessible('page1'));

      const result = await primary(inputFor(guest));

      expect(client.searchAccessiblePages).toHaveBeenCalledWith(
        ['page1', 'hidden', 'deleted'],
        guest,
        NO_FILTER,
      );
      expect(attachmentIdsOf(result.items)).toEqual({
        page1: ['att1', 'att2'],
      });
      expect(result.primarySlot).toBe('attachments');
      expect(pageSearchFn).not.toHaveBeenCalled();
    });

    it('never reports a hit count and never asks Elasticsearch for one', async () => {
      client.searchAttachments.mockImplementation(
        serveHits([esHit('page1', 'a'), esHit('hidden', 'b')]),
      );
      client.searchAccessiblePages.mockResolvedValue(accessible('page1'));

      const result = await primary(inputFor(viewer));

      expect(result.meta.total).toBeNull();
      for (const [body] of client.searchAttachments.mock.calls) {
        expect(body.track_total_hits).toBe(false);
      }
    });

    it('stops searching attachments once the primary timeout has answered the request', async () => {
      const hidden = Array.from({ length: 1000 }, (_, i) =>
        esHit(`hidden${i}`, `att${i}`),
      );
      const serve = serveHits(hidden);
      client.searchAttachments.mockImplementation(async (body) =>
        delayed(await serve(body), 30),
      );
      client.searchAccessiblePages.mockImplementation(
        accessibleAmong(() => false),
      );

      const result = await primary(inputFor(guest), 0, 1, 40);
      const callsAtAnswer = client.searchAttachments.mock.calls.length;
      await delayed(null, 300);

      expect(result.meta.primaryResultIncomplete).toBe(true);
      // at most the round in flight when the timeout fired finishes
      expect(client.searchAttachments.mock.calls.length).toBe(callsAtAnswer);
    });

    it('answers a term matching only hidden attachments exactly like a term matching nothing', async () => {
      const hidden = Array.from({ length: 50 }, (_, i) =>
        esHit(`hidden${i % 7}`, `att${i}`),
      );
      client.searchAccessiblePages.mockImplementation(
        accessibleAmong(() => false),
      );

      client.searchAttachments.mockImplementation(serveHits(hidden));
      const onlyHidden = await primary(inputFor(guest), 0, 2);
      client.searchAttachments.mockImplementation(serveHits([]));
      const nothing = await primary(inputFor(guest), 0, 2);

      expect(onlyHidden).toEqual(nothing);
      expect(onlyHidden).toEqual({
        facet: 'attachments',
        primarySlot: 'attachments',
        items: [],
        meta: { total: null, primaryResultIncomplete: false },
      });
    });

    it('returns the same page of visible hits however many hidden hits outrank them', async () => {
      const visible = Array.from({ length: 6 }, (_, i) =>
        esHit(`visible${i}`, `v${i}`),
      );
      const hiddenFirst = (n: number) => [
        ...Array.from({ length: n }, (_, i) => esHit(`hidden${i}`, `h${i}`)),
        ...visible,
      ];
      client.searchAccessiblePages.mockImplementation(
        accessibleAmong((id) => id.startsWith('visible')),
      );

      const responses: IPrimarySearchResult[] = [];
      for (const n of [0, 3, 40]) {
        client.searchAttachments.mockImplementation(serveHits(hiddenFirst(n)));
        // biome-ignore lint/performance/noAwaitInLoops: responses are compared afterwards
        responses.push(await primary(inputFor(viewer), 2, 2));
      }

      expect(responses[0].items.map((i) => i.data._id)).toEqual([
        'visible2',
        'visible3',
      ]);
      expect(responses[1]).toEqual(responses[0]);
      expect(responses[2]).toEqual(responses[0]);
    });

    it('pages through the visible pages disjointly and in score order', async () => {
      const hits = [
        esHit('p0', 'a0'),
        esHit('hidden', 'h0'),
        esHit('p1', 'a1'),
        esHit('p0', 'a2'),
        esHit('p2', 'a3'),
        esHit('hidden', 'h1'),
        esHit('p3', 'a4'),
        esHit('p4', 'a5'),
      ];
      client.searchAttachments.mockImplementation(serveHits(hits));
      client.searchAccessiblePages.mockImplementation(
        accessibleAmong((id) => id !== 'hidden'),
      );

      const pages: string[][] = [];
      for (const from of [0, 2, 4, 6]) {
        // biome-ignore lint/performance/noAwaitInLoops: pages are requested one after another
        const result = await primary(inputFor(viewer), from, 2);
        pages.push(result.items.map((i) => i.data._id));
      }

      expect(pages).toEqual([['p0', 'p1'], ['p2', 'p3'], ['p4'], []]);
    });

    it('stops widening the window at the cap', async () => {
      const hidden = Array.from({ length: WINDOW_CAP + 50 }, (_, i) =>
        esHit(`hidden${i}`, `h${i}`),
      );
      client.searchAttachments.mockImplementation(
        serveHits([...hidden, esHit('visible', 'v')]),
      );
      client.searchAccessiblePages.mockImplementation(
        accessibleAmong((id) => id === 'visible'),
      );

      const result = await primary(inputFor(viewer), 0, 2);

      expect(result.items).toEqual([]);
      const fetched = client.searchAttachments.mock.calls.reduce(
        (sum, [body]) => sum + Number(body.size),
        0,
      );
      expect(fetched).toBe(WINDOW_CAP);
    });

    it('does not search attachments for an operator-only query', async () => {
      const result = await primary(inputFor(viewer, { tag: ['draft'] }));

      expect(client.searchAttachments).not.toHaveBeenCalled();
      expect(result.items).toEqual([]);
      expect(result.meta).toEqual({
        total: null,
        primaryResultIncomplete: false,
      });
    });

    it('does not run the permission check when nothing matched', async () => {
      client.searchAttachments.mockImplementation(serveHits([]));

      const result = await primary(inputFor(viewer));

      expect(client.searchAccessiblePages).not.toHaveBeenCalled();
      expect(result.items).toEqual([]);
      expect(result.meta.primaryResultIncomplete).toBe(false);
    });

    it('builds snippet segments from the highlight fragment', async () => {
      const hit = esHit('page1', 'att1');
      client.searchAttachments.mockImplementation(
        serveHits([
          { ...hit, highlight: { content: ['hello <em>world</em> foo'] } },
        ]),
      );
      client.searchAccessiblePages.mockResolvedValue(accessible('page1'));

      const result = await primary(inputFor(viewer));

      expect(result.items[0].meta?.attachmentHits?.[0].snippets).toEqual([
        { text: 'hello ', highlighted: false },
        { text: 'world', highlighted: true },
        { text: ' foo', highlighted: false },
      ]);
    });

    it('returns empty + incomplete when the attachment search times out', async () => {
      client.searchAttachments.mockImplementation(() =>
        delayed(
          makeAttachmentResponse([{ pageId: 'p1', attachmentId: 'a' }]),
          200,
        ),
      );

      const result = await primary(inputFor(viewer), 0, 20, 50);

      expect(result.items).toEqual([]);
      expect(result.meta).toEqual({
        total: null,
        primaryResultIncomplete: true,
      });
    });

    describe('fail-close when the permission check does not succeed', () => {
      beforeEach(() => {
        client.searchAttachments.mockImplementation(
          serveHits([esHit('page1', 'att1')]),
        );
      });

      it('drops every hit when the permission check throws, logging it as an error', async () => {
        client.searchAccessiblePages.mockRejectedValue(
          new Error('The page index search had 1 failed shard(s)'),
        );

        const result = await primary(inputFor(viewer));

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

        const result = await primary(inputFor(viewer), 0, 20, 50);

        expect(result.items).toEqual([]);
        expect(loggerWarn).toHaveBeenCalledWith(
          expect.objectContaining({ failure: 'timeout' }),
          expect.stringContaining('permission check failed'),
        );
      });

      it('keeps only the pages that a partial answer returned', async () => {
        client.searchAttachments.mockImplementation(
          serveHits([esHit('page1', 'att1'), esHit('page2', 'att2')]),
        );
        client.searchAccessiblePages.mockResolvedValue(accessible('page2'));

        const result = await primary(inputFor(viewer));

        expect(attachmentIdsOf(result.items)).toEqual({ page2: ['att2'] });
      });
    });
  });

  describe('resolveSecondary', () => {
    it('is a no-op for facet=attachments', async () => {
      const result = await makeAggregator().resolveSecondary(inputFor(viewer), {
        facet: 'attachments',
        primaryIds: ['page1'],
      });

      expect(result).toEqual({ facet: 'attachments', enrichments: {} });
      expect(client.searchAccessiblePages).not.toHaveBeenCalled();
      expect(client.searchAttachments).not.toHaveBeenCalled();
    });

    it('re-checks the client-supplied ids for the viewer and the operators, and searches attachments only for the visible ones', async () => {
      client.searchAccessiblePages.mockResolvedValue(accessible('page1'));
      client.searchAttachments.mockResolvedValue(
        makeAttachmentResponse([
          { pageId: 'page1', attachmentId: 'att1' },
          { pageId: 'page1', attachmentId: 'att2' },
        ]),
      );
      const input = inputFor(guest, { match: ['kw'], tag: ['spec'] });

      const result = await makeAggregator().resolveSecondary(input, {
        facet: 'all',
        primaryIds: ['page1', 'forbidden', 'page1', 'no-such-page'],
      });

      expect(client.searchAccessiblePages).toHaveBeenCalledWith(
        ['page1', 'forbidden', 'no-such-page'],
        guest,
        { ...NO_FILTER, terms: { ...NO_FILTER.terms, tag: ['spec'] } },
      );
      const searchBody = JSON.stringify(
        client.searchAttachments.mock.calls[0][0],
      );
      expect(searchBody).toContain('"pageId":["page1"]');
      expect(searchBody).not.toContain('spec');
      expect(
        result.enrichments.page1?.attachmentHits?.map((h) => h.attachmentId),
      ).toEqual(['att1', 'att2']);
      expect(Object.keys(result.enrichments)).toEqual(['page1']);
    });

    it('returns nothing for an operator-only query without searching', async () => {
      const result = await makeAggregator().resolveSecondary(
        inputFor(viewer, { tag: ['spec'] }),
        { facet: 'all', primaryIds: ['page1'] },
      );

      expect(result).toEqual({ facet: 'all', enrichments: {} });
      expect(client.searchAttachments).not.toHaveBeenCalled();
    });

    it('drops a hit for a page the permission check did not return even if the attachment search returns it', async () => {
      client.searchAccessiblePages.mockResolvedValue(accessible('page1'));
      client.searchAttachments.mockResolvedValue(
        makeAttachmentResponse([
          { pageId: 'page1', attachmentId: 'att1' },
          { pageId: 'forbidden', attachmentId: 'att-x' },
        ]),
      );

      const result = await makeAggregator().resolveSecondary(inputFor(viewer), {
        facet: 'all',
        primaryIds: ['page1', 'forbidden'],
      });

      expect(Object.keys(result.enrichments)).toEqual(['page1']);
    });

    it('returns no enrichments and skips the attachment search when no id is visible', async () => {
      client.searchAccessiblePages.mockResolvedValue([]);

      const result = await makeAggregator().resolveSecondary(inputFor(viewer), {
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

      const result = await makeAggregator().resolveSecondary(inputFor(viewer), {
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

      const result = await makeAggregator().resolveSecondary(inputFor(viewer), {
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
        makeAggregator().resolveSecondary(inputFor(viewer), {
          facet: 'all',
          primaryIds: many,
        }),
      ).rejects.toThrow(RangeError);
      await expect(
        makeAggregator().resolveSecondary(inputFor(viewer), {
          facet: 'all',
          primaryIds: [...many.slice(0, 20), 'page0'],
        }),
      ).resolves.toEqual({ facet: 'all', enrichments: {} });
    });
  });
});
