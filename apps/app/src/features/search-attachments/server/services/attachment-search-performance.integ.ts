/**
 * Latency of the search requests as they go through the real GROWI app
 * (`crowi.express`: global middlewares, the rate limiter, each route's auth
 * chain and handler), on a real Elasticsearch and MongoDB. Run by hand, not in
 * CI: a shared CI machine cannot hold a latency ratio steady enough to gate on.
 *
 *   CI=true ATTACHMENT_SEARCH_PERF=1 env -u MONGO_URI pnpm vitest run attachment-search-performance.integ
 *
 * The behaviour past the time limits (facet=attachments reporting an
 * incomplete result, the secondary search throwing a timeout error) is pinned
 * in attachment-search-result-aggregator.spec.ts.
 */

import { createServer, type Server } from 'node:http';
import { PageGrant } from '@growi/core';
import mongoose from 'mongoose';
import request from 'supertest';

import { bootGrowiApp } from '^/test/setup/growi-routes';
import {
  deleteIndices,
  elasticsearchOrigin,
  indexExists,
  refreshIndex,
  uniqueRunToken,
} from '^/test/setup/search-attachments/es-inspection';
import {
  elasticsearchUriFor,
  wireAttachmentSearch,
} from '^/test/setup/search-attachments/wire-attachment-search';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import { configManager } from '~/server/service/config-manager';
import type ElasticsearchDelegator from '~/server/service/search-delegator/elasticsearch';
import { getClient } from '~/server/service/search-delegator/elasticsearch.testing';
import { prisma } from '~/utils/prisma';

import { attachmentIndexNames } from './attachment-search-delegator-extension';
import { createAttachmentSearchResultAggregator } from './create-attachment-search-result-aggregator';

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
const PAGE_SIZE = 20;
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

const shuffled = <T>(items: readonly T[]): T[] => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

type PageSearchBody = {
  ok: boolean;
  data?: Array<{
    data: { _id: string };
    meta?: { attachmentHits?: unknown[] };
  }>;
  meta?: { facet?: string | null; primaryResultIncomplete?: boolean };
};

describe.skipIf(
  process.env.ELASTICSEARCH_URI == null ||
    process.env.ATTACHMENT_SEARCH_PERF !== '1',
)('attachment search latency through the app (manual)', () => {
  let crowi: Crowi;
  let server: Server;
  let featureEnabled = true;
  const pageIds: mongoose.Types.ObjectId[] = [];

  beforeAll(async () => {
    crowi = await bootGrowiApp({
      beforeServer: async (booted) => {
        // read on every request by the global middlewares; the in-memory
        // session store keeps requests from writing sessions to MongoDB
        await booted.setupGrowiInfoService();
        booted.sessionConfig = {
          rolling: true,
          secret: 'attachment-search-performance-integ',
          resave: false,
          saveUninitialized: false,
          cookie: { maxAge: 60_000 },
          genid: () => new mongoose.Types.ObjectId().toString(),
        };
      },
    });

    // After bootGrowiApp: it restores its own getConfig spy when it returns.
    const originalGetConfig = configManager.getConfig.bind(configManager);
    vi.spyOn(configManager, 'getConfig').mockImplementation((key, source) => {
      if (key === 'app:elasticsearchUri') {
        return elasticsearchUriFor(PAGE_INDEX);
      }
      if (
        key === 'app:attachmentFullTextSearch:extractorUri' ||
        key === 'app:attachmentFullTextSearch:extractorToken'
      ) {
        return featureEnabled ? 'http://127.0.0.1:1' : undefined;
      }
      return originalGetConfig(key, source);
    });
    // Measured as a guest: the rate limiter allows a user 500 requests a
    // minute per endpoint, fewer than this test sends to /_api/search, and a
    // guest 2,500 per IP.
    vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(true);

    await wireAttachmentSearch(crowi);
    const { searchService } = crowi;
    const delegator =
      searchService.fullTextSearchDelegator as ElasticsearchDelegator;
    // The attachment index must carry its own mapping, not one that the bulk
    // load below would create on the fly.
    expect(await indexExists(NAMES.alias)).toBe(true);
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

    const userId = new mongoose.Types.ObjectId();
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

    // One listener for every request, rather than one per supertest call
    server = createServer(crowi.express);
    await new Promise<void>((resolve) => server.listen(0, resolve));
  }, 600_000);

  afterAll(async () => {
    // unset when beforeAll failed earlier; the cleanup below must still run
    if (server != null) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    vi.restoreAllMocks();
    await deleteIndices([PAGE_INDEX, ...NAMES.indices]);
    await mongoose.model('Page').deleteMany({ _id: { $in: pageIds } });
    await prisma.revisions.deleteMany({
      where: { pageId: { in: pageIds.map(String) } },
    });
  });

  it('keeps the page search unchanged and the secondary search within 500ms (p95)', async () => {
    const q = `${TOKEN} report`;

    const pageSearch = (enabled: boolean) => (): request.Test => {
      featureEnabled = enabled;
      return request(server).get('/_api/search').query({ q, limit: PAGE_SIZE });
    };

    const sample = await pageSearch(true)();
    const sampleBody: PageSearchBody = sample.body;
    const primaryIds = (sampleBody.data ?? []).map((item) => item.data._id);
    expect(primaryIds).toHaveLength(PAGE_SIZE);
    expect(JSON.stringify(sampleBody)).not.toContain('attachmentHits');
    const baselineBody: PageSearchBody = (await pageSearch(false)()).body;
    expect((baselineBody.data ?? []).map((item) => item.data._id)).toEqual(
      primaryIds,
    );

    const scenarios = {
      pagesEnabled: pageSearch(true),
      pagesDisabled: pageSearch(false),
      secondary: (): request.Test => {
        featureEnabled = true;
        return request(server)
          .get('/_api/v3/search/attachments')
          .query({ q, pageIds: primaryIds.join(',') });
      },
      facetAttachments: (): request.Test => {
        featureEnabled = true;
        return request(server)
          .get('/_api/search')
          .query({ q, facet: 'attachments', limit: PAGE_SIZE });
      },
    } as const;
    type Scenario = keyof typeof scenarios;
    const names = Object.keys(scenarios) as Scenario[];

    // /_api/search answers its errors with HTTP 200 and ok: false
    const succeeded = (name: Scenario, res: request.Response): boolean => {
      if (name === 'secondary') return res.status === 200;
      const body: PageSearchBody = res.body;
      if (res.status !== 200 || body.ok !== true) return false;
      // an incomplete facet=attachments answer skipped the work being timed
      return (
        name !== 'facetAttachments' ||
        body.meta?.primaryResultIncomplete === false
      );
    };

    // not vacuous: the disabled side really is disabled, and both attachment
    // searches take the attachment path and find hits
    featureEnabled = false;
    const disabledSecondary = await request(server)
      .get('/_api/v3/search/attachments')
      .query({ q, pageIds: primaryIds.join(',') });
    featureEnabled = true;
    expect(disabledSecondary.status).toBe(503);
    expect(disabledSecondary.body.errors[0].code).toBe('feature_disabled');
    const secondarySample = await scenarios.secondary();
    expect(secondarySample.status).toBe(200);
    expect(
      Object.keys(secondarySample.body.enrichments).length,
    ).toBeGreaterThan(0);
    const facetSample: PageSearchBody = (await scenarios.facetAttachments())
      .body;
    expect(facetSample.ok).toBe(true);
    expect(facetSample.meta).toMatchObject({
      facet: 'attachments',
      primaryResultIncomplete: false,
    });
    expect(facetSample.data?.length ?? 0).toBeGreaterThan(0);

    for (let i = 0; i < WARMUP; i++) {
      for (const name of names) {
        // biome-ignore lint/performance/noAwaitInLoops: requests are timed one at a time
        await scenarios[name]();
      }
    }
    const samples = Object.fromEntries(
      names.map((name) => [name, [] as number[]]),
    ) as Record<Scenario, number[]>;
    const failures: string[] = [];
    // Interleaved, so drift in the machine's load affects every scenario
    // alike; in a new order each round, so no scenario always runs right
    // after the same one (and on caches that one warmed).
    for (let i = 0; i < ITERATIONS; i++) {
      for (const name of shuffled(names)) {
        const start = performance.now();
        // biome-ignore lint/performance/noAwaitInLoops: requests are timed one at a time
        const res = await scenarios[name]();
        samples[name].push(performance.now() - start);
        // a fast error must not count as a fast search
        if (!succeeded(name, res)) {
          failures.push(`${name}: ${res.status}`);
        }
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
    ) as Record<Scenario, { p50: number; p95: number }>;
    // biome-ignore lint/suspicious/noConsole: the numbers are this test's output
    console.table(summary);

    expect(failures).toEqual([]);
    // the same work either way, so equal within the machine's noise
    expect(summary.pagesEnabled.p95).toBeLessThanOrEqual(
      summary.pagesDisabled.p95 * 1.3,
    );
    expect(summary.secondary.p95).toBeLessThanOrEqual(500);
  }, 600_000);
});
