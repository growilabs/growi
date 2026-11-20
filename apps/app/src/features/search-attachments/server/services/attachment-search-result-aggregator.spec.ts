import type { IUserHasId } from '@growi/core';
import { type MockProxy, mock } from 'vitest-mock-extended';

import type { IPageWithSearchMeta } from '~/interfaces/search';
import type { QueryTerms } from '~/server/interfaces/search';

import { PAGE_HITS } from '../queries/build-attachments-by-page-ids-query';
import {
  type AttachmentEsHit,
  type AttachmentIndexClient,
  type AttachmentSearchInput,
  type AttachmentSearchResponse,
  AttachmentSearchResultAggregator,
  AttachmentSearchTimeoutError,
  type IPrimarySearchResult,
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

// Shaped like the collapsed response of buildAttachmentsByPageIdsQuery
const makeAttachmentResponse = (
  hits: Array<{ pageId: string; attachmentId: string }>,
): AttachmentSearchResponse => {
  const pageIds = [...new Set(hits.map((h) => h.pageId))];
  return {
    hits: {
      hits: pageIds.map((pageId) => ({
        ...esHit(pageId, `collapsed-${pageId}`),
        inner_hits: {
          [PAGE_HITS]: {
            hits: {
              hits: hits
                .filter((h) => h.pageId === pageId)
                .map((h) => esHit(h.pageId, h.attachmentId)),
            },
          },
        },
      })),
    },
  };
};

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
        String(i.data._id),
        (i.meta?.attachmentHits ?? []).map((h) => h.attachmentId),
      ]),
  );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AttachmentSearchResultAggregator', () => {
  let client: MockProxy<AttachmentIndexClient>;

  const makeAggregator = (timeoutMs = 800) =>
    new AttachmentSearchResultAggregator(client, timeoutMs);

  beforeEach(() => {
    client = mock<AttachmentIndexClient>();
  });

  describe('searchPrimary facet=attachments', () => {
    const primary = (
      input: AttachmentSearchInput,
      from = 0,
      size = 20,
      timeoutMs?: number,
    ) => makeAggregator(timeoutMs).searchPrimary(input, { from, size });

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
    });

    it('never reports a hit count and never asks Elasticsearch for one', async () => {
      client.searchAttachments.mockImplementation(
        serveHits([esHit('page1', 'a'), esHit('hidden', 'b')]),
      );
      client.searchAccessiblePages.mockResolvedValue(accessible('page1'));

      const result = await primary(inputFor(viewer));

      expect(result.meta).toEqual({ primaryResultIncomplete: false });
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
        items: [],
        meta: { primaryResultIncomplete: false },
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

    it('matches attachment content with the keyword terms only', async () => {
      client.searchAttachments.mockImplementation(serveHits([]));

      await primary(
        inputFor(viewer, {
          match: ['minutes'],
          author: ['jim'],
          not_prefix: ['/user'],
        }),
      );

      const body = JSON.stringify(client.searchAttachments.mock.calls[0][0]);
      expect(body).toContain('"query":"minutes"');
      expect(body).not.toContain('jim');
      expect(body).not.toContain('/user');
    });

    it('does not search attachments for an operator-only query', async () => {
      const result = await primary(inputFor(viewer, { tag: ['draft'] }));

      expect(client.searchAttachments).not.toHaveBeenCalled();
      expect(result.items).toEqual([]);
      expect(result.meta).toEqual({ primaryResultIncomplete: false });
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
      expect(result.meta).toEqual({ primaryResultIncomplete: true });
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
        { primaryIds: ['page1'] },
      );

      expect(result).toEqual({ enrichments: {} });
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
        primaryIds: ['page1', 'forbidden'],
      });

      expect(Object.keys(result.enrichments)).toEqual(['page1']);
    });

    it('returns no enrichments and skips the attachment search when no id is visible', async () => {
      client.searchAccessiblePages.mockResolvedValue([]);

      const result = await makeAggregator().resolveSecondary(inputFor(viewer), {
        primaryIds: ['forbidden'],
      });

      expect(result.enrichments).toEqual({});
      expect(client.searchAttachments).not.toHaveBeenCalled();
    });

    it('rejects when the permission check throws, without searching attachments', async () => {
      client.searchAccessiblePages.mockRejectedValue(new Error('es down'));

      await expect(
        makeAggregator().resolveSecondary(inputFor(viewer), {
          primaryIds: ['page1'],
        }),
      ).rejects.toThrow('es down');
      expect(client.searchAttachments).not.toHaveBeenCalled();
    });

    it('rejects when the attachment search throws', async () => {
      client.searchAccessiblePages.mockResolvedValue(accessible('page1'));
      client.searchAttachments.mockRejectedValue(new Error('attachments down'));

      await expect(
        makeAggregator().resolveSecondary(inputFor(viewer), {
          primaryIds: ['page1'],
        }),
      ).rejects.toThrow('attachments down');
    });

    it('rejects with the timeout error when the secondary phase exceeds its limit', async () => {
      client.searchAccessiblePages.mockImplementation(() =>
        delayed(accessible('page1'), 200),
      );
      const aggregator = new AttachmentSearchResultAggregator(client, 800, 50);

      await expect(
        aggregator.resolveSecondary(inputFor(viewer), {
          primaryIds: ['page1'],
        }),
      ).rejects.toThrow(AttachmentSearchTimeoutError);
    });

    it('throws RangeError for more than 20 distinct ids, counting duplicates once', async () => {
      const many = Array.from({ length: 21 }, (_, i) => `page${i}`);
      client.searchAccessiblePages.mockResolvedValue([]);

      await expect(
        makeAggregator().resolveSecondary(inputFor(viewer), {
          primaryIds: many,
        }),
      ).rejects.toThrow(RangeError);
      await expect(
        makeAggregator().resolveSecondary(inputFor(viewer), {
          primaryIds: [...many.slice(0, 20), 'page0'],
        }),
      ).resolves.toEqual({ enrichments: {} });
    });
  });
});
