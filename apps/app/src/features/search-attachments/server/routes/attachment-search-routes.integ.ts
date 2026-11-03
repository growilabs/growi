/**
 * The attachment search routes as mounted in the real GROWI app: every
 * request goes through `crowi.express` (session, passport, certifyOrigin,
 * mongoSanitize, the route registry and each route's own auth chain), against
 * real MongoDB and Elasticsearch. Only `req.user` is injected, at the point
 * where passport would have set it.
 */

import { type IUserHasId, PageGrant } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import mongoose from 'mongoose';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import { bootGrowiApp } from '^/test/setup/growi-routes';

import type Crowi from '~/server/crowi';
import { AccessToken } from '~/server/models/access-token';
import type { PageDocument, PageModel } from '~/server/models/page';
import { configManager } from '~/server/service/config-manager';
import SearchService from '~/server/service/search';
import ElasticsearchDelegator from '~/server/service/search-delegator/elasticsearch';
import {
  getClient,
  setIndexName,
} from '~/server/service/search-delegator/elasticsearch.testing';
import { listRegisteredRoutes } from '~/test-utils/express-route-walker';
import { prisma } from '~/utils/prisma';

import { AttachmentSearchDelegatorExtension } from '../services/attachment-search-delegator-extension';
import type { AttachmentSearchIndexerInterface } from '../services/attachment-search-indexer';
import { createAttachmentSearchResultAggregator } from '../services/create-attachment-search-result-aggregator';

vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  }),
}));

// ELASTICSEARCH_URI is mapped from VITE_ELASTICSEARCH_URI by test/setup/elasticsearch.ts
const esUri = process.env.ELASTICSEARCH_URI;

// The ES tokenizer splits on letter/digit boundaries, so tokens stay alphabetic.
const RUN =
  `${process.env.VITEST_WORKER_ID ?? '1'}${Date.now()}${Math.floor(Math.random() * 1e6)}`.replace(
    /[0-9]/g,
    (d) => 'abcdefghij'[Number(d)],
  );
const TOKEN = `zzattroute${RUN}`;
const PAGE_INDEX = `fix_attroute_pages_${RUN}`;
const ATTACHMENT_INDEX = `fix_attroute_attachments_${RUN}`;
const USER_HEADER = 'x-attachment-search-routes-test-user';

const PAGE_KINDS = ['public', 'restricted', 'owner'] as const;
type PageKind = (typeof PAGE_KINDS)[number];
const USER_NAMES = ['creator', 'other', 'admin', 'readOnly'] as const;
type UserName = (typeof USER_NAMES)[number];
type Viewer = UserName | 'guest';

class SearchServiceForTest extends SearchService {
  static forDelegator(
    crowi: Crowi,
    delegator: ElasticsearchDelegator,
  ): SearchServiceForTest {
    const service = new SearchServiceForTest();
    service.crowi = crowi;
    service.fullTextSearchDelegator = delegator;
    service.nqDelegators = service.generateNQDelegators(delegator);
    service.isErrorOccuredOnHealthcheck = false;
    return service;
  }
}

type SearchBody = {
  ok: boolean;
  code?: number;
  data?: Array<{
    data: { _id: string };
    meta?: {
      elasticSearchResult?: { snippet?: string | null };
      attachmentHits?: unknown[];
    };
  }>;
  meta?: Record<string, unknown>;
};

describe.skipIf(esUri == null)(
  'attachment search routes in the real app (real Elasticsearch + MongoDB)',
  () => {
    let crowi: Crowi;
    let esHost: string;
    let guestAllowed = true;
    let featureEnabled = true;
    const users = {} as Record<UserName, IUserHasId>;
    const CREATOR_API_TOKEN = `attroute-api-token-${RUN}`;
    let pageReadToken: string;
    let otherScopeToken: string;
    const pageIds = {} as Record<PageKind, string>;
    const kindOf = new Map<string, PageKind>();

    const kinds = (ids: Iterable<string>): string[] =>
      [...ids].map((id) => kindOf.get(id) ?? `unknown:${id}`).sort();

    const as = (viewer: Viewer, req: request.Test): request.Test =>
      viewer === 'guest' ? req : req.set(USER_HEADER, viewer);

    const search = async (
      viewer: Viewer,
      query: Record<string, string> | string,
    ): Promise<request.Response> =>
      as(viewer, request(crowi.express).get('/_api/search').query(query));

    const secondary = async (
      viewer: Viewer,
      query: Record<string, string> | string,
    ): Promise<request.Response> =>
      as(
        viewer,
        request(crowi.express).get('/_api/v3/search/attachments').query(query),
      );

    // What the existing page search shows this viewer the content of.
    const pagesWithSnippet = async (viewer: Viewer): Promise<string[]> => {
      const body: SearchBody = (await search(viewer, { q: TOKEN })).body;
      return kinds(
        (body.data ?? [])
          .filter((item) => item.meta?.elasticSearchResult?.snippet != null)
          .map((item) => item.data._id),
      );
    };

    beforeAll(async () => {
      if (esUri == null) throw new Error('ELASTICSEARCH_URI is not set');
      esHost = new URL(esUri).origin;

      crowi = await bootGrowiApp({
        beforeServer: async (booted) => {
          // read on every request by the global middlewares; the in-memory
          // session store keeps requests from writing to MongoDB
          await booted.setupGrowiInfoService();
          booted.sessionConfig = {
            rolling: true,
            secret: 'attachment-search-routes-integ',
            resave: false,
            saveUninitialized: false,
            cookie: { maxAge: 60_000 },
            genid: () => new mongoose.Types.ObjectId().toString(),
          };
        },
        beforeRoutes: (booted) => {
          booted.express.use(function injectTestUser(req, _res, next) {
            const name = req.header(USER_HEADER) as UserName | undefined;
            if (name != null && users[name] != null) {
              (req as typeof req & { user?: IUserHasId }).user = users[name];
            }
            next();
          });
        },
      });

      const originalGetConfig = configManager.getConfig.bind(configManager);
      vi.spyOn(configManager, 'getConfig').mockImplementation((key, source) => {
        if (
          key === 'app:attachmentFullTextSearch:extractorUri' ||
          key === 'app:attachmentFullTextSearch:extractorToken'
        ) {
          return featureEnabled ? 'configured' : undefined;
        }
        return originalGetConfig(key, source);
      });
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockImplementation(
        () => guestAllowed,
      );

      const delegator = new ElasticsearchDelegator(crowi.socketIoService);
      await delegator.initClient();
      setIndexName(delegator, PAGE_INDEX);
      await delegator.createIndex(PAGE_INDEX);
      const esClient = getClient(delegator);
      await esClient.indices.putAlias({
        index: PAGE_INDEX,
        name: delegator.aliasName,
      });
      const attachmentExt = new AttachmentSearchDelegatorExtension(esClient);
      await attachmentExt.createAttachmentIndex(ATTACHMENT_INDEX);

      const searchService = SearchServiceForTest.forDelegator(crowi, delegator);
      searchService.setAttachmentSearchResultAggregator(
        createAttachmentSearchResultAggregator({
          searchService,
          esClient,
          attachmentIndexName: ATTACHMENT_INDEX,
          primaryTimeoutMs: 15_000,
          secondaryTimeoutMs: 15_000,
        }),
      );
      crowi.searchService = searchService;
      crowi.attachmentSearchIndexer = mock<AttachmentSearchIndexerInterface>();

      const User = mongoose.model<IUserHasId>('User');
      for (const name of USER_NAMES) {
        const username = `attroute-${name}-${RUN}`.slice(0, 60);
        // biome-ignore lint/performance/noAwaitInLoops: a handful of fixture users
        const [created] = await User.insertMany([
          {
            name: username,
            username,
            email: `${username}@example.com`,
            admin: name === 'admin',
            readOnly: name === 'readOnly',
            ...(name === 'creator' ? { apiToken: CREATOR_API_TOKEN } : {}),
          },
        ]);
        users[name] = created;
      }
      const oneHourLater = new Date(Date.now() + 60 * 60 * 1000);
      pageReadToken = (
        await AccessToken.generateToken(users.creator._id, oneHourLater, [
          SCOPE.READ.FEATURES.PAGE,
        ])
      ).token;
      otherScopeToken = (
        await AccessToken.generateToken(users.creator._id, oneHourLater, [
          SCOPE.READ.USER_SETTINGS.INFO,
        ])
      ).token;

      const Page = mongoose.model<PageDocument, PageModel>('Page');
      const grants: Record<PageKind, number> = {
        public: PageGrant.GRANT_PUBLIC,
        restricted: PageGrant.GRANT_RESTRICTED,
        owner: PageGrant.GRANT_OWNER,
      };
      for (const kind of PAGE_KINDS) {
        const pageId = new mongoose.Types.ObjectId();
        // biome-ignore lint/performance/noAwaitInLoops: three fixture pages
        const revision = await prisma.revisions.create({
          data: {
            pageId: pageId.toString(),
            body: `This ${kind} page mentions ${TOKEN} in its body.`,
            format: 'markdown',
            authorId: users.creator._id,
          },
        });
        await Page.insertMany([
          {
            _id: pageId,
            path: `/attroute/${RUN}/${kind}`,
            grant: grants[kind],
            creator: users.creator._id,
            lastUpdateUser: users.creator._id,
            grantedUsers: kind === 'owner' ? [users.creator._id] : [],
            revision: revision._id,
          },
        ]);
        pageIds[kind] = pageId.toString();
        kindOf.set(pageId.toString(), kind);
      }
      await delegator.updateOrInsertPages(() =>
        Page.find({
          _id: {
            $in: Object.values(pageIds).map(
              (id) => new mongoose.Types.ObjectId(id),
            ),
          },
        }),
      );

      const now = new Date().toISOString();
      for (const kind of PAGE_KINDS) {
        const attachmentId = new mongoose.Types.ObjectId().toString();
        // biome-ignore lint/performance/noAwaitInLoops: three fixture docs
        await attachmentExt.syncAttachmentIndexed(
          attachmentId,
          pageIds[kind],
          [
            {
              attachmentId,
              pageId: pageIds[kind],
              pageNumber: 1,
              label: null,
              fileName: `${kind}.pdf`,
              originalName: `${kind}.pdf`,
              fileFormat: 'pdf',
              fileSize: 100,
              attachmentType: 'WIKI_PAGE',
              content: `attached file for ${TOKEN}`,
              created_at: now,
              updated_at: now,
            },
          ],
          [ATTACHMENT_INDEX],
        );
      }
      for (const index of [PAGE_INDEX, ATTACHMENT_INDEX]) {
        // biome-ignore lint/performance/noAwaitInLoops: two indices
        const res = await fetch(`${esHost}/${index}/_refresh`, {
          method: 'POST',
        });
        expect(res.ok).toBe(true);
      }
    }, 120_000);

    afterAll(async () => {
      vi.restoreAllMocks();
      crowi.attachmentSearchIndexer = undefined;
      for (const index of [PAGE_INDEX, ATTACHMENT_INDEX]) {
        // biome-ignore lint/performance/noAwaitInLoops: two indices
        await fetch(`${esHost}/${index}`, { method: 'DELETE' });
      }
      await AccessToken.deleteAllTokensByUserId(users.creator._id);
      const ids = Object.values(pageIds);
      await mongoose.model('Page').deleteMany({ _id: { $in: ids } });
      await prisma.revisions.deleteMany({ where: { pageId: { in: ids } } });
      await mongoose
        .model('User')
        .deleteMany({ _id: { $in: Object.values(users).map((u) => u._id) } });
    });

    beforeEach(() => {
      guestAllowed = true;
      featureEnabled = true;
    });

    describe('route registration', () => {
      const chainOf = (method: string, path: string): readonly string[] => {
        const route = listRegisteredRoutes(crowi.express).find(
          (r) => r.method === method && r.path === path,
        );
        expect(route, `${method} ${path} is registered`).toBeDefined();
        return route?.middlewareNames ?? [];
      };

      it('mounts the secondary search behind the same reader chain as /_api/search, then the gate', () => {
        const pageSearch = chainOf('GET', '/_api/search');
        const secondarySearch = chainOf('GET', '/_api/v3/search/attachments/');

        const authOf = (chain: readonly string[]) =>
          chain.filter((n) =>
            ['accessTokenParserMw', 'loginRequired'].includes(n),
          );
        expect(authOf(pageSearch)).toEqual([
          'accessTokenParserMw',
          'loginRequired',
        ]);
        expect(authOf(secondarySearch)).toEqual(authOf(pageSearch));
        expect(secondarySearch.indexOf('requireSearchAttachmentsEnabled')).toBe(
          secondarySearch.indexOf('loginRequired') + 1,
        );
      });

      it('mounts re-extraction and the admin endpoints with their auth chains', () => {
        expect(
          chainOf('POST', '/_api/v3/attachments/:id/reextract').slice(0, 4),
        ).toEqual([
          'accessTokenParserMw',
          'loginRequired',
          'excludeReadOnlyUser',
          'requireSearchAttachmentsEnabled',
        ]);
        for (const [method, path] of [
          ['GET', '/_api/v3/admin/attachment-search/config'],
          ['PUT', '/_api/v3/admin/attachment-search/config'],
          ['GET', '/_api/v3/admin/attachment-search/failures'],
        ]) {
          expect(chainOf(method, path).slice(0, 3)).toEqual([
            'accessTokenParserMw',
            'loginRequired',
            'adminRequired',
          ]);
        }
      });
    });

    describe('guests', () => {
      it('get nothing from either search while guests may not read', async () => {
        guestAllowed = false;

        const facet = await search('guest', { q: TOKEN, facet: 'all' });
        const legacy = await search('guest', { q: TOKEN });
        const enrichment = await secondary('guest', {
          q: TOKEN,
          pageIds: pageIds.public,
        });

        expect(facet.status).toBe(legacy.status);
        expect(facet.status).not.toBe(200);
        expect(enrichment.status).toBe(403);
        expect(JSON.stringify([facet.body, enrichment.body])).not.toContain(
          'attachmentHits',
        );
      });

      it('see the public attachment while guests may read', async () => {
        const enrichment = await secondary('guest', {
          q: TOKEN,
          pageIds: Object.values(pageIds).join(','),
        });

        expect(enrichment.status).toBe(200);
        expect(kinds(Object.keys(enrichment.body.enrichments))).toEqual(
          await pagesWithSnippet('guest'),
        );
      });
    });

    // guests may not read here, so a token that is not accepted ends as a rejected guest
    describe.each([
      { name: 'the legacy API token', token: () => CREATOR_API_TOKEN },
      {
        name: 'an access token with the page read scope',
        token: () => pageReadToken,
      },
    ])('authenticated by $name', ({ token }) => {
      beforeEach(() => {
        guestAllowed = false;
      });

      it('both searches run as the token owner', async () => {
        const facet = await request(crowi.express)
          .get('/_api/search')
          .query({ q: TOKEN, facet: 'all', access_token: token() });
        const enrichment = await request(crowi.express)
          .get('/_api/v3/search/attachments')
          .query({
            q: TOKEN,
            pageIds: Object.values(pageIds).join(','),
            access_token: token(),
          });

        expect(facet.status).toBe(200);
        expect(
          kinds(
            (facet.body as SearchBody).data
              ?.filter((i) => (i.meta?.attachmentHits?.length ?? 0) > 0)
              .map((i) => i.data._id) ?? [],
          ),
        ).toEqual(['owner', 'public']);
        expect(enrichment.status).toBe(200);
        expect(kinds(Object.keys(enrichment.body.enrichments))).toEqual([
          'owner',
          'public',
        ]);
      });
    });

    it('rejects an access token without the page read scope', async () => {
      guestAllowed = false;

      const legacy = await request(crowi.express)
        .get('/_api/search')
        .query({ q: TOKEN, access_token: otherScopeToken });
      const facet = await request(crowi.express)
        .get('/_api/search')
        .query({ q: TOKEN, facet: 'all', access_token: otherScopeToken });
      const enrichment = await request(crowi.express)
        .get('/_api/v3/search/attachments')
        .query({
          q: TOKEN,
          pageIds: pageIds.owner,
          access_token: otherScopeToken,
        });

      expect(facet.status).toBe(legacy.status);
      expect(facet.status).not.toBe(200);
      expect(enrichment.status).toBe(403);
    });

    describe.each([
      { viewer: 'guest' as const, expected: ['public'] },
      { viewer: 'other' as const, expected: ['public'] },
      // GRANT_RESTRICTED pages are never listed by the page search
      { viewer: 'creator' as const, expected: ['owner', 'public'] },
    ])('as $viewer, attachment hits follow the page search', ({
      viewer,
      expected,
    }) => {
      it('shows the page search the expected pages (not vacuous)', async () => {
        expect(await pagesWithSnippet(viewer)).toEqual(expected);
      });

      it('facet=all lists the page search pages and attaches hits only to those', async () => {
        const legacy: SearchBody = (await search(viewer, { q: TOKEN })).body;
        const res = await search(viewer, { q: TOKEN, facet: 'all' });
        const body: SearchBody = res.body;

        expect(body.ok).toBe(true);
        expect(body.meta?.facet).toBe('all');
        expect(kinds((body.data ?? []).map((i) => i.data._id))).toEqual(
          kinds((legacy.data ?? []).map((i) => i.data._id)),
        );
        expect(
          kinds(
            (body.data ?? [])
              .filter((i) => (i.meta?.attachmentHits?.length ?? 0) > 0)
              .map((i) => i.data._id),
          ),
        ).toEqual(expected);
      });

      it('facet=attachments lists only pages the page search shows', async () => {
        const body: SearchBody = (
          await search(viewer, { q: TOKEN, facet: 'attachments' })
        ).body;

        expect(body.meta).toMatchObject({ facet: 'attachments', total: null });
        expect(kinds((body.data ?? []).map((i) => i.data._id))).toEqual(
          expected,
        );
      });

      it('the secondary search enriches only pages the page search shows', async () => {
        const res = await secondary(viewer, {
          q: TOKEN,
          pageIds: Object.values(pageIds).join(','),
        });

        expect(res.status).toBe(200);
        expect(kinds(Object.keys(res.body.enrichments))).toEqual(expected);
      });
    });

    describe('while the feature is disabled', () => {
      beforeEach(() => {
        featureEnabled = false;
      });

      // `took` is Elasticsearch's own timing and differs between requests.
      const withoutTook = (body: SearchBody) => ({
        ...body,
        meta: { ...body.meta, took: undefined },
      });

      it('answers facet=all with the plain page search', async () => {
        const legacy = await search('creator', { q: TOKEN });
        const facet = await search('creator', { q: TOKEN, facet: 'all' });

        expect(legacy.status).toBe(200);
        expect(legacy.body.ok).toBe(true);
        expect(withoutTook(facet.body)).toEqual(withoutTook(legacy.body));
        expect(JSON.stringify(facet.body)).not.toContain('attachmentHits');
      });

      it('closes the secondary search and re-extraction', async () => {
        const enrichment = await secondary('creator', {
          q: TOKEN,
          pageIds: pageIds.public,
        });
        const reextract = await request(crowi.express)
          .post(
            `/_api/v3/attachments/${new mongoose.Types.ObjectId()}/reextract`,
          )
          .set(USER_HEADER, 'admin');

        expect(enrichment.status).toBe(503);
        expect(reextract.status).toBe(503);
      });

      it('keeps the admin config readable, so the feature can be enabled', async () => {
        const res = await request(crowi.express)
          .get('/_api/v3/admin/attachment-search/config')
          .set(USER_HEADER, 'admin');

        expect(res.status).toBe(200);
        expect(res.body.config.isAttachmentFullTextSearchEnabled).toBe(false);
      });
    });

    describe('malformed requests', () => {
      it.each([
        `q=${TOKEN}&pageIds[$ne]=secret`,
        `q=${TOKEN}&pageIds=${'0'.repeat(24)},secret`,
        `q=${TOKEN}&pageIds=${Array.from({ length: 21 }, (_, i) => i.toString(16).padStart(24, '0')).join(',')}`,
      ])('the secondary search rejects %s with 400', async (query) => {
        const res = await secondary('creator', query);

        expect(res.status).toBe(400);
        expect(res.text).not.toContain('secret');
      });

      it.each<Record<string, string>>([
        { facet: 'secret' },
        { facet: 'all', resolve: 'secret' },
      ])('the page search rejects %o', async (params) => {
        const res = await search('creator', { q: TOKEN, ...params });

        expect(res.body).toMatchObject({ ok: false, code: 400 });
        expect(res.text).not.toContain('secret');
      });
    });

    describe('re-extraction and admin endpoints', () => {
      const reextract = (viewer: Viewer) =>
        as(
          viewer,
          request(crowi.express).post(
            `/_api/v3/attachments/${new mongoose.Types.ObjectId()}/reextract`,
          ),
        );

      it('re-extraction rejects guests and read-only users before the handler', async () => {
        expect((await reextract('guest')).status).toBe(403);
        expect((await reextract('readOnly')).status).toBe(400);
        // reaching the handler: an unknown attachment
        expect((await reextract('other')).status).toBe(404);
      });

      it('admin endpoints answer an admin only', async () => {
        for (const path of ['config', 'failures']) {
          const url = `/_api/v3/admin/attachment-search/${path}`;
          // biome-ignore lint/performance/noAwaitInLoops: two endpoints
          expect((await request(crowi.express).get(url)).status).toBe(403);
          expect(
            (await request(crowi.express).get(url).set(USER_HEADER, 'other'))
              .status,
          ).toBe(302);
          expect(
            (await request(crowi.express).get(url).set(USER_HEADER, 'admin'))
              .status,
          ).toBe(200);
        }
      });
    });
  },
);
