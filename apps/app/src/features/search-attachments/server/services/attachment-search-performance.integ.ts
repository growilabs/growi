/**
 * Latency of the faceted search against the plain page search, on a real
 * Elasticsearch and MongoDB. Run by hand, not in CI: a shared CI machine
 * cannot hold a latency ratio steady enough to gate on.
 *
 *   ATTACHMENT_SEARCH_PERF=1 env -u MONGO_URI pnpm vitest run attachment-search-performance.integ
 *
 * The behaviour past the time limits (facet=all falling back to the page
 * result, facet=attachments reporting an incomplete result, the secondary
 * search returning no enrichment) is pinned in
 * attachment-search-result-aggregator.spec.ts.
 */

import { PageGrant } from '@growi/core';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';
import {
  deleteIndices,
  elasticsearchOrigin,
  refreshIndex,
  uniqueRunToken,
} from '^/test/setup/search-attachments/es-inspection';
import {
  elasticsearchUriFor,
  overrideConfig,
  wireAttachmentSearch,
} from '^/test/setup/search-attachments/wire-attachment-search';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import type SearchService from '~/server/service/search';
import type ElasticsearchDelegator from '~/server/service/search-delegator/elasticsearch';
import { getClient } from '~/server/service/search-delegator/elasticsearch.testing';
import { prisma } from '~/utils/prisma';

import { attachmentIndexNames } from './attachment-search-delegator-extension';
import { createAttachmentSearchResultAggregator } from './create-attachment-search-result-aggregator';
import { resolveAttachmentSearchViewer } from './resolve-attachment-search-viewer';

vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  }),
}));

const RUN = uniqueRunToken();
const PAGE_INDEX = `fix_attperf_pages_${RUN}`;
const NAMES = attachmentIndexNames(PAGE_INDEX);
const TOKEN = `zzperf${RUN}`;

const PAGE_COUNT = 2000;
const ATTACHMENTS_PER_PAGE = 3;
const WARMUP = 20;
const ITERATIONS = 200;

const FILLER = [
  'meeting',
  'report',
  'design',
  'review',
  'schedule',
  'budget',
  'release',
  'incident',
];
const filler = (i: number, n: number): string =>
  Array.from({ length: n }, (_, k) => FILLER[(i * 7 + k) % FILLER.length]).join(
    ' ',
  );

const percentile = (samples: number[], p: number): number => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
};

const timeIt = async (fn: () => Promise<unknown>): Promise<number> => {
  const start = performance.now();
  await fn();
  return performance.now() - start;
};

describe.skipIf(
  process.env.ELASTICSEARCH_URI == null ||
    process.env.ATTACHMENT_SEARCH_PERF !== '1',
)('attachment search latency (manual)', () => {
  let crowi: Crowi;
  let searchService: SearchService;
  const pageIds: mongoose.Types.ObjectId[] = [];
  let userId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    overrideConfig({
      'app:elasticsearchUri': elasticsearchUriFor(PAGE_INDEX),
      'app:attachmentFullTextSearch:extractorUri': 'http://127.0.0.1:1',
      'app:attachmentFullTextSearch:extractorToken': 'perf',
    });
    crowi = await getInstance();
    await wireAttachmentSearch(crowi);
    searchService = crowi.searchService;
    const delegator =
      searchService.fullTextSearchDelegator as ElasticsearchDelegator;
    await delegator.createIndex(PAGE_INDEX);
    const esClient = getClient(delegator);
    await esClient.indices.putAlias({
      index: PAGE_INDEX,
      name: delegator.aliasName,
    });
    // Generous limits: measure the searches, not the fallbacks
    searchService.setAttachmentSearchResultAggregator(
      createAttachmentSearchResultAggregator({
        searchService,
        esClient,
        attachmentIndexName: NAMES.alias,
        primaryTimeoutMs: 60_000,
        secondaryTimeoutMs: 60_000,
      }),
    );

    userId = new mongoose.Types.ObjectId();
    const Page = mongoose.model<PageDocument, PageModel>('Page');
    for (let start = 0; start < PAGE_COUNT; start += 200) {
      const batch = Array.from(
        { length: Math.min(200, PAGE_COUNT - start) },
        (_, k) => start + k,
      );
      // biome-ignore lint/performance/noAwaitInLoops: batches keep MongoDB load bounded
      const docs = await Promise.all(
        batch.map(async (i) => {
          const pageId = new mongoose.Types.ObjectId();
          // a third of the pages mention the token in the body
          const body = `${filler(i, 40)}${i % 3 === 0 ? ` ${TOKEN}` : ''}`;
          const revision = await prisma.revisions.create({
            data: {
              pageId: pageId.toString(),
              body,
              format: 'markdown',
              authorId: userId.toString(),
            },
          });
          pageIds.push(pageId);
          return {
            _id: pageId,
            path: `/attperf/${RUN}/${i}`,
            grant: PageGrant.GRANT_PUBLIC,
            creator: userId,
            lastUpdateUser: userId,
            revision: revision._id,
          };
        }),
      );
      await Page.insertMany(docs);
    }
    await delegator.updateOrInsertPages(() =>
      Page.find({ _id: { $in: pageIds } }),
    );

    // a third of the attachments mention the token
    const lines: string[] = [];
    const now = new Date().toISOString();
    pageIds.forEach((pageId, i) => {
      for (let a = 0; a < ATTACHMENTS_PER_PAGE; a++) {
        const attachmentId = new mongoose.Types.ObjectId().toString();
        lines.push(
          JSON.stringify({
            index: { _index: NAMES.alias, _id: `${attachmentId}_1` },
          }),
          JSON.stringify({
            attachmentId,
            pageId: pageId.toString(),
            pageNumber: 1,
            label: null,
            fileName: `${attachmentId}.pdf`,
            originalName: `file-${i}-${a}.pdf`,
            fileFormat: 'application/pdf',
            fileSize: 1000,
            attachmentType: 'WIKI_PAGE',
            content: `${filler(i + a, 200)}${(i + a) % 3 === 1 ? ` ${TOKEN}` : ''}`,
            created_at: now,
            updated_at: now,
          }),
        );
      }
    });
    for (let start = 0; start < lines.length; start += 2000) {
      // biome-ignore lint/performance/noAwaitInLoops: bounded bulk requests
      const res = await fetch(`${elasticsearchOrigin()}/_bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-ndjson' },
        body: `${lines.slice(start, start + 2000).join('\n')}\n`,
      });
      expect(((await res.json()) as { errors: boolean }).errors).toBe(false);
    }
    await refreshIndex(PAGE_INDEX);
    await refreshIndex(NAMES.alias);
  }, 600_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await deleteIndices([PAGE_INDEX, ...NAMES.indices]);
    await mongoose.model('Page').deleteMany({ _id: { $in: pageIds } });
    await prisma.revisions.deleteMany({
      where: { pageId: { in: pageIds.map(String) } },
    });
  });

  it('keeps facet=all within +30% of the page search, and the secondary search within 500ms (p95)', async () => {
    const viewer = await resolveAttachmentSearchViewer(null);
    const query = `${TOKEN} report`;

    const pageSearch = async () => {
      const [result, name] = await searchService.searchKeyword(
        query,
        null,
        viewer.user,
        viewer.userGroups,
        { offset: 0, limit: 20 },
      );
      return searchService.formatSearchResult(
        result,
        name,
        viewer.user,
        viewer.userGroups,
      );
    };
    const firstPage = await pageSearch();
    const primaryIds = firstPage.data.map((item) => item.data._id.toString());
    expect(primaryIds).toHaveLength(20);

    const scenarios = {
      pages: pageSearch,
      allFirstPage: () =>
        searchService.searchByFacet(query, viewer, { facet: 'all' }),
      allSecondPage: () =>
        searchService.searchByFacet(query, viewer, { facet: 'all', from: 20 }),
      attachments: () =>
        searchService.searchByFacet(query, viewer, { facet: 'attachments' }),
      secondary: () =>
        searchService.resolveAttachmentSecondary(query, viewer, {
          primaryIds,
        }),
    } as const;
    type Scenario = keyof typeof scenarios;
    const names = Object.keys(scenarios) as Scenario[];

    // not vacuous: the facet=all first page carries attachment hits
    const sample = await scenarios.allFirstPage();
    expect(
      sample.items.some((i) => (i.meta?.attachmentHits?.length ?? 0) > 0),
    ).toBe(true);

    for (let i = 0; i < WARMUP; i++) {
      for (const name of names) {
        // biome-ignore lint/performance/noAwaitInLoops: requests are timed one at a time
        await scenarios[name]();
      }
    }
    const samples = Object.fromEntries(
      names.map((name) => [name, [] as number[]]),
    ) as Record<Scenario, number[]>;
    // interleaved, so drift in the machine's load affects every scenario alike
    for (let i = 0; i < ITERATIONS; i++) {
      for (const name of names) {
        // biome-ignore lint/performance/noAwaitInLoops: requests are timed one at a time
        samples[name].push(await timeIt(scenarios[name]));
      }
    }

    const summary = Object.fromEntries(
      names.map((name) => [
        name,
        {
          p50: Number(percentile(samples[name], 0.5).toFixed(1)),
          p95: Number(percentile(samples[name], 0.95).toFixed(1)),
        },
      ]),
    );
    // biome-ignore lint/suspicious/noConsole: the numbers are this test's output
    console.table(summary);

    expect(summary.allFirstPage.p95).toBeLessThanOrEqual(
      summary.pages.p95 * 1.3,
    );
    expect(summary.allSecondPage.p95).toBeLessThanOrEqual(
      summary.pages.p95 * 1.3,
    );
    expect(summary.secondary.p95).toBeLessThanOrEqual(500);
  }, 600_000);
});
