import { GroupType, type IUserHasId, PageGrant } from '@growi/core';
import mongoose, { type Model } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import ExternalUserGroup from '~/features/external-user-group/server/models/external-user-group';
import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import type {
  IFormattedSearchResult,
  IPageWithSearchMeta,
} from '~/interfaces/search';
import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import UserGroup from '~/server/models/user-group';
import UserGroupRelation from '~/server/models/user-group-relation';
import { configManager } from '~/server/service/config-manager';
import SearchService from '~/server/service/search';
import ElasticsearchDelegator from '~/server/service/search-delegator/elasticsearch';
import {
  getClient,
  setIndexName,
} from '~/server/service/search-delegator/elasticsearch.testing';
import { ES8ClientDelegator } from '~/server/service/search-delegator/elasticsearch-client-delegator/es8-client-delegator';
import { ES9ClientDelegator } from '~/server/service/search-delegator/elasticsearch-client-delegator/es9-client-delegator';
import { prisma } from '~/utils/prisma';

import { mgetPagesForPermissionBody } from '../queries/mget-pages-for-permission-body';
import { AttachmentSearchDelegatorExtension } from './attachment-search-delegator-extension';
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

// ELASTICSEARCH_URI is mapped from VITE_ELASTICSEARCH_URI by test/setup/elasticsearch.ts
const esUri = process.env.ELASTICSEARCH_URI;

// The ES tokenizer splits on letter/digit boundaries, so tokens stay alphabetic.
const digitsToAlpha = (s: string): string =>
  s.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
const RUN = digitsToAlpha(
  `${process.env.VITEST_WORKER_ID ?? '1'}${Date.now()}${Math.floor(Math.random() * 1e6)}`,
);
// Every scenario has its own token so that its fixtures never show up in another one.
const TOKEN = `zzattperm${RUN}`;
const XSS_TOKEN = `zzxss${RUN}`;
const PROBE_TOKEN = `zzprobe${RUN}`;
const MISSING_TOKEN = `zzmissing${RUN}`;
const PAGING_TOKEN = `zzpaging${RUN}`;
const OP_TOKEN = `zzoperator${RUN}`;
const DRIFT_TOKEN = `zzdrift${RUN}`;
const TAG_A = `attperm-tag-${RUN}`;
const PAGE_INDEX = `fix_attperm_pages_${RUN}`;
const ATTACHMENT_INDEX = `fix_attperm_attachments_${RUN}`;

const PAGE_KINDS = [
  'public',
  'restricted',
  'owner',
  'specified',
  'userGroup',
  'externalGroup',
] as const;

const PAGING_KINDS = [
  'paging0',
  'paging1',
  'paging2',
  'paging3',
  'paging4',
] as const;

const OPERATOR_KINDS = ['opUser', 'opA', 'opB', 'opGroup'] as const;
const DRIFT_KINDS = ['driftGrant', 'driftGone', 'driftOk'] as const;

const VIEWER_NAMES = [
  'guest',
  'creator',
  'other',
  'specifiedUser',
  'groupMember',
  'externalGroupMember',
  'admin',
] as const;
type ViewerName = (typeof VIEWER_NAMES)[number];

const LIST_POLICIES = [
  { hideByOwner: false, hideByGroup: false },
  { hideByOwner: true, hideByGroup: false },
  { hideByOwner: false, hideByGroup: true },
  { hideByOwner: true, hideByGroup: true },
];

class SearchServiceForTest extends SearchService {
  static forDelegator(
    crowi: Crowi,
    delegator: ElasticsearchDelegator,
  ): SearchServiceForTest {
    const service = new SearchServiceForTest();
    service.crowi = crowi;
    service.fullTextSearchDelegator = delegator;
    service.nqDelegators = service.generateNQDelegators(delegator);
    return service;
  }
}

const sorted = (ids: Iterable<string>): string[] => [...ids].sort();

// Page items compared as the JSON the API would send, without the attachment part.
const asPageJson = (items: IPageWithSearchMeta[]): unknown =>
  JSON.parse(
    JSON.stringify(
      items.map((item) => ({
        data: item.data,
        meta: Object.fromEntries(
          Object.entries(item.meta ?? {}).filter(
            ([key]) => key !== 'attachmentHits',
          ),
        ),
      })),
    ),
  );

describe.skipIf(esUri == null)(
  'attachment search permission (real Elasticsearch + MongoDB)',
  () => {
    let crowi: Crowi;
    let delegator: ElasticsearchDelegator;
    let searchService: SearchServiceForTest;
    // The same service without an attachment aggregator (feature not initialized).
    let searchServiceWithoutAggregator: SearchServiceForTest;
    let esHost: string;
    let esServerMajor: number;

    const users = {} as Record<Exclude<ViewerName, 'guest'>, IUserHasId>;
    const pageIds: Record<string, string> = {};
    const idToKind = new Map<string, string>();
    const settings = {
      hideByOwner: false,
      hideByGroup: false,
      disableUserPages: false,
    };
    const createdUserGroupIds: mongoose.Types.ObjectId[] = [];
    const createdExternalGroupIds: mongoose.Types.ObjectId[] = [];
    const createdTagIds: string[] = [];
    let userGroupName: string;

    const kindsOf = (ids: Iterable<unknown>): string[] =>
      sorted(
        [...ids].map((id) => {
          const key = String(id);
          return idToKind.get(key) ?? `unknown:${key}`;
        }),
      );

    const viewerOf = (name: ViewerName) =>
      resolveAttachmentSearchViewer(name === 'guest' ? null : users[name]);

    // The existing page search pipeline (`/_api/search`): the ground truth.
    const pageSearch = async (
      query: string,
      name: ViewerName,
      { offset = 0, limit = 20 }: { offset?: number; limit?: number } = {},
    ): Promise<IFormattedSearchResult> => {
      const viewer = await viewerOf(name);
      const [result, delegatorName] = await searchService.searchKeyword(
        query,
        null,
        viewer.user,
        viewer.userGroups,
        { offset, limit },
      );
      return searchService.formatSearchResult(
        result,
        delegatorName,
        viewer.user,
        viewer.userGroups,
      );
    };

    // What the existing page search shows this viewer content of.
    const pagesWithSnippet = async (
      name: ViewerName,
      query = TOKEN,
    ): Promise<string[]> => {
      const formatted = await pageSearch(query, name, { limit: 50 });
      return kindsOf(
        formatted.data
          .filter((item) => item.meta?.elasticSearchResult?.snippet != null)
          .map((item) => item.data._id),
      );
    };

    const attachmentHitKinds = (items: IPageWithSearchMeta[]): string[] =>
      kindsOf(
        items
          .filter((i) => (i.meta?.attachmentHits?.length ?? 0) > 0)
          .map((i) => i.data._id),
      );

    const refresh = async (index: string): Promise<void> => {
      const res = await fetch(`${esHost}/${index}/_refresh`, {
        method: 'POST',
      });
      expect(res.ok).toBe(true);
    };

    type SeedOptions = {
      grant?: number;
      grantedUsers?: IUserHasId[];
      grantedGroups?: { item: mongoose.Types.ObjectId; type: GroupType }[];
      body?: string;
      path?: string;
      author?: IUserHasId;
    };

    const seedPage = async (
      kind: string,
      {
        grant = PageGrant.GRANT_PUBLIC,
        grantedUsers = [],
        grantedGroups = [],
        body = `This ${kind} page mentions ${TOKEN} in its body.`,
        path = `/attperm/${RUN}/${kind}`,
        author = users.creator,
      }: SeedOptions = {},
    ): Promise<void> => {
      const pageId = new mongoose.Types.ObjectId();
      const revision = await prisma.revisions.create({
        data: {
          pageId: pageId.toString(),
          body,
          format: 'markdown',
          authorId: author._id,
        },
      });
      const Page = mongoose.model<PageDocument, PageModel>('Page');
      await Page.insertMany([
        {
          _id: pageId,
          path,
          grant,
          creator: author._id,
          lastUpdateUser: author._id,
          grantedUsers: grantedUsers.map((u) => u._id),
          grantedGroups,
          revision: revision._id,
        },
      ]);
      pageIds[kind] = pageId.toString();
      idToKind.set(pageId.toString(), kind);
    };

    const tagPage = async (kind: string, tagName: string): Promise<void> => {
      const tag = await prisma.tags.create({ data: { name: tagName } });
      createdTagIds.push(tag.id);
      await prisma.pagetagrelations.create({
        data: { relatedPageId: pageIds[kind], relatedTagId: tag.id },
      });
    };

    let attachmentExt: AttachmentSearchDelegatorExtension;
    const indexAttachment = async (
      kind: string,
      attachmentId: string,
      content: string,
    ): Promise<void> => {
      const now = new Date().toISOString();
      const pageId = pageIds[kind];
      await attachmentExt.syncAttachmentIndexed(
        attachmentId,
        pageId,
        [
          {
            attachmentId,
            pageId,
            pageNumber: 1,
            label: null,
            fileName: `${attachmentId}.pdf`,
            originalName: `${attachmentId}.pdf`,
            fileFormat: 'pdf',
            fileSize: 100,
            attachmentType: 'WIKI_PAGE',
            content,
            created_at: now,
            updated_at: now,
          },
        ],
        [ATTACHMENT_INDEX],
      );
    };

    beforeAll(async () => {
      crowi = await getInstance();
      if (esUri == null) throw new Error('ELASTICSEARCH_URI is not set');
      esHost = new URL(esUri).origin;
      const info = (await (await fetch(esHost)).json()) as {
        version: { number: string };
      };
      esServerMajor = Number(info.version.number.split('.')[0]);

      const originalGetConfig = configManager.getConfig.bind(configManager);
      vi.spyOn(configManager, 'getConfig').mockImplementation((key, source) => {
        if (key === 'security:list-policy:hideRestrictedByOwner') {
          return settings.hideByOwner;
        }
        if (key === 'security:list-policy:hideRestrictedByGroup') {
          return settings.hideByGroup;
        }
        if (key === 'security:disableUserPages') {
          return settings.disableUserPages;
        }
        return originalGetConfig(key, source);
      });

      delegator = new ElasticsearchDelegator(crowi.socketIoService);
      await delegator.initClient();
      setIndexName(delegator, PAGE_INDEX);
      await delegator.createIndex(PAGE_INDEX);
      const esClient = getClient(delegator);
      await esClient.indices.putAlias({
        index: PAGE_INDEX,
        name: delegator.aliasName,
      });

      attachmentExt = new AttachmentSearchDelegatorExtension(esClient);
      await attachmentExt.createAttachmentIndex(ATTACHMENT_INDEX);

      searchService = SearchServiceForTest.forDelegator(crowi, delegator);
      searchServiceWithoutAggregator = SearchServiceForTest.forDelegator(
        crowi,
        delegator,
      );
      searchService.setAttachmentSearchResultAggregator(
        createAttachmentSearchResultAggregator({
          searchService,
          esClient,
          attachmentIndexName: ATTACHMENT_INDEX,
          // generous limits: this suite checks permission results, not latency
          primaryTimeoutMs: 15_000,
          secondaryTimeoutMs: 15_000,
        }),
      );

      const User = mongoose.model<IUserHasId>('User') as Model<IUserHasId>;
      for (const name of VIEWER_NAMES) {
        if (name === 'guest') continue;
        const username = `attperm-${name}-${RUN}`.slice(0, 60);
        // biome-ignore lint/performance/noAwaitInLoops: a handful of fixture users
        const [created] = await User.insertMany([
          {
            name: username,
            username,
            email: `${username}@example.com`,
            admin: name === 'admin',
          },
        ]);
        users[name] = created;
      }

      userGroupName = `attperm-g-${RUN}`;
      const userGroup = await UserGroup.create({ name: userGroupName });
      createdUserGroupIds.push(userGroup._id);
      await UserGroupRelation.create({
        relatedGroup: userGroup._id,
        relatedUser: users.groupMember._id,
      });
      const externalGroup = await ExternalUserGroup.create({
        name: `attperm-eg-${RUN}`,
        externalId: `attperm-eg-${RUN}`,
        provider: 'ldap',
      });
      createdExternalGroupIds.push(externalGroup._id);
      await ExternalUserGroupRelation.create({
        relatedGroup: externalGroup._id,
        relatedUser: users.externalGroupMember._id,
      });
      const userGroupGrant = [
        { item: userGroup._id, type: GroupType.userGroup },
      ];

      // --- the grant matrix ---------------------------------------------
      await seedPage('public');
      await seedPage('restricted', { grant: PageGrant.GRANT_RESTRICTED });
      await seedPage('owner', {
        grant: PageGrant.GRANT_OWNER,
        grantedUsers: [users.creator],
      });
      await seedPage('specified', {
        grant: PageGrant.GRANT_SPECIFIED,
        grantedUsers: [users.creator, users.specifiedUser],
      });
      await seedPage('userGroup', {
        grant: PageGrant.GRANT_USER_GROUP,
        grantedGroups: userGroupGrant,
      });
      await seedPage('externalGroup', {
        grant: PageGrant.GRANT_USER_GROUP,
        grantedGroups: [
          { item: externalGroup._id, type: GroupType.externalUserGroup },
        ],
      });

      // --- stored XSS in a page body --------------------------------------
      // Two pages so that from=1 still returns one of them.
      for (const kind of ['xss1', 'xss2']) {
        // biome-ignore lint/performance/noAwaitInLoops: two fixture pages
        await seedPage(kind, {
          body: `${XSS_TOKEN} <img src=x onerror=alert(1)> ${XSS_TOKEN}`,
        });
      }

      // --- paging over the gated stream -----------------------------------
      for (const kind of PAGING_KINDS) {
        // biome-ignore lint/performance/noAwaitInLoops: a handful of fixture pages
        await seedPage(kind, { body: `${kind} page` });
      }

      // --- search operators and security:disableUserPages -----------------
      await seedPage('opUser', {
        path: `/user/${users.other.username}/memo-${RUN}`,
        body: `user page ${OP_TOKEN}`,
      });
      await seedPage('opA', {
        path: `/attperm/${RUN}/ops/a`,
        body: `page a ${OP_TOKEN}`,
      });
      await seedPage('opB', {
        path: `/attperm/${RUN}/ops/b`,
        body: `page b ${OP_TOKEN}`,
        author: users.specifiedUser,
      });
      await seedPage('opGroup', {
        path: `/attperm/${RUN}/ops/group`,
        body: `group page ${OP_TOKEN}`,
        grant: PageGrant.GRANT_USER_GROUP,
        grantedGroups: userGroupGrant,
      });
      await tagPage('opA', TAG_A);

      // --- MongoDB and the page index disagree -----------------------------
      for (const kind of DRIFT_KINDS) {
        // biome-ignore lint/performance/noAwaitInLoops: a handful of fixture pages
        await seedPage(kind, { body: `${kind} page ${DRIFT_TOKEN}` });
      }

      // A page whose attachments stay indexed but which is no longer in the page index.
      pageIds.deleted = new mongoose.Types.ObjectId().toString();
      idToKind.set(pageIds.deleted, 'deleted');

      const Page = mongoose.model<PageDocument, PageModel>('Page');
      // aggregate $match does not cast strings, so pass ObjectIds
      const indexed = Object.entries(pageIds)
        .filter(([kind]) => kind !== 'deleted')
        .map(([, id]) => new mongoose.Types.ObjectId(id));
      await delegator.updateOrInsertPages(() =>
        Page.find({ _id: { $in: indexed } }),
      );

      for (const kind of [...PAGE_KINDS, 'deleted' as const]) {
        // biome-ignore lint/performance/noAwaitInLoops: a handful of fixture docs
        await indexAttachment(
          kind,
          `att-${kind}`,
          `attached file for ${TOKEN}`,
        );
      }
      // Does not contain the keyword: must never be returned.
      await indexAttachment('public', 'att-unrelated', 'nothing relevant here');

      // Hidden from guest/other under every list policy.
      for (const [i, kind] of [
        'restricted',
        'owner',
        'specified',
        'restricted',
      ].entries()) {
        // biome-ignore lint/performance/noAwaitInLoops: a handful of fixture docs
        await indexAttachment(kind, `att-probe-${i}`, `probe ${PROBE_TOKEN}`);
      }

      // Hidden hits score higher than every visible one; visible hits are ordered.
      for (const i of [0, 1, 2]) {
        // biome-ignore lint/performance/noAwaitInLoops: a handful of fixture docs
        await indexAttachment(
          'owner',
          `att-paging-hidden-${i}`,
          Array(12).fill(PAGING_TOKEN).join(' '),
        );
      }
      for (const [i, kind] of PAGING_KINDS.entries()) {
        // biome-ignore lint/performance/noAwaitInLoops: a handful of fixture docs
        await indexAttachment(
          kind,
          `att-${kind}`,
          Array(PAGING_KINDS.length - i)
            .fill(PAGING_TOKEN)
            .join(' '),
        );
      }

      for (const kind of OPERATOR_KINDS) {
        // biome-ignore lint/performance/noAwaitInLoops: a handful of fixture docs
        await indexAttachment(kind, `att-${kind}`, `attached ${OP_TOKEN}`);
      }

      for (const kind of DRIFT_KINDS) {
        // biome-ignore lint/performance/noAwaitInLoops: a handful of fixture docs
        await indexAttachment(kind, `att-${kind}`, `attached ${DRIFT_TOKEN}`);
      }

      await refresh(PAGE_INDEX);
      await refresh(ATTACHMENT_INDEX);

      // Not vacuous: every seeded page really is in the page index.
      const countRes = await fetch(`${esHost}/${PAGE_INDEX}/_count`);
      expect(((await countRes.json()) as { count: number }).count).toBe(
        indexed.length,
      );

      // Change MongoDB only, after indexing: the page index is now stale.
      await Page.updateOne(
        { _id: pageIds.driftGrant },
        { grant: PageGrant.GRANT_OWNER, grantedUsers: [users.creator._id] },
      );
      await Page.deleteOne({ _id: pageIds.driftGone });
    }, 60_000);

    afterAll(async () => {
      vi.restoreAllMocks();
      for (const index of [PAGE_INDEX, ATTACHMENT_INDEX]) {
        // biome-ignore lint/performance/noAwaitInLoops: two indices
        await fetch(`${esHost}/${index}`, { method: 'DELETE' });
      }
      const Page = mongoose.model<PageDocument, PageModel>('Page');
      const ids = Object.values(pageIds);
      await Page.deleteMany({ _id: { $in: ids } });
      await prisma.revisions.deleteMany({ where: { pageId: { in: ids } } });
      await prisma.pagetagrelations.deleteMany({
        where: { relatedTagId: { in: createdTagIds } },
      });
      await prisma.tags.deleteMany({ where: { id: { in: createdTagIds } } });
      await UserGroupRelation.deleteMany({
        relatedGroup: { $in: createdUserGroupIds },
      });
      await UserGroup.deleteMany({ _id: { $in: createdUserGroupIds } });
      await ExternalUserGroupRelation.deleteMany({
        relatedGroup: { $in: createdExternalGroupIds },
      });
      await ExternalUserGroup.deleteMany({
        _id: { $in: createdExternalGroupIds },
      });
      await mongoose
        .model('User')
        .deleteMany({ _id: { $in: Object.values(users).map((u) => u._id) } });
    });

    beforeEach(() => {
      settings.hideByOwner = false;
      settings.hideByGroup = false;
      settings.disableUserPages = false;
    });

    describe.each(
      LIST_POLICIES,
    )('list policy hideRestrictedByOwner=$hideByOwner hideRestrictedByGroup=$hideByGroup', (policy) => {
      beforeEach(() => {
        settings.hideByOwner = policy.hideByOwner;
        settings.hideByGroup = policy.hideByGroup;
      });

      describe.each([TOKEN, `"${TOKEN}"`])('query %s', (query) => {
        it.each(
          VIEWER_NAMES,
        )('viewer %s sees attachment hits exactly for the pages page search shows content of', async (name) => {
          const viewer = await viewerOf(name);
          const expected = await pagesWithSnippet(name, query);

          const onlyAttachments = await searchService.searchByFacet(
            query,
            viewer,
            { facet: 'attachments', from: 0, size: 20 },
          );
          const combined = await searchService.searchByFacet(query, viewer, {
            facet: 'all',
            from: 0,
            size: 20,
          });
          const secondary = await searchService.resolveAttachmentSecondary(
            query,
            viewer,
            { primaryIds: [...PAGE_KINDS, 'deleted'].map((k) => pageIds[k]) },
          );

          expect(onlyAttachments.meta.primaryResultIncomplete).toBe(false);
          expect(kindsOf(onlyAttachments.items.map((i) => i.data._id))).toEqual(
            expected,
          );
          expect(attachmentHitKinds(combined.items)).toEqual(expected);
          expect(kindsOf(Object.keys(secondary.enrichments))).toEqual(expected);

          const returnedAttachmentIds = [
            ...onlyAttachments.items,
            ...combined.items,
          ].flatMap((i) => i.meta?.attachmentHits ?? []);
          expect(
            returnedAttachmentIds.map((h) => h.attachmentId),
          ).not.toContain('att-unrelated');
          // The real highlighter output becomes a highlighted text segment.
          for (const hit of returnedAttachmentIds) {
            expect(
              hit.snippets.some((s) => s.highlighted && s.text.includes(TOKEN)),
            ).toBe(true);
            expect(hit.snippets.map((s) => s.text).join('')).not.toContain(
              '<em',
            );
          }
        }, 30_000);

        it.each(
          VIEWER_NAMES,
        )('viewer %s gets page items identical to the page search response', async (name) => {
          const viewer = await viewerOf(name);

          const firstPage = await searchService.searchByFacet(query, viewer, {
            facet: 'all',
            from: 0,
            size: 20,
          });
          const secondPage = await searchService.searchByFacet(query, viewer, {
            facet: 'all',
            from: 1,
            size: 20,
          });
          const pagesOnly = await searchService.searchByFacet(query, viewer, {
            facet: 'pages',
            from: 0,
            size: 20,
          });
          const withoutAggregator =
            await searchServiceWithoutAggregator.searchByFacet(query, viewer, {
              facet: 'all',
              from: 0,
              size: 20,
            });

          const expectedFirst = await pageSearch(query, name);
          const expectedSecond = await pageSearch(query, name, { offset: 1 });
          expect(firstPage.items.length).toBeGreaterThan(0);
          expect(asPageJson(firstPage.items)).toEqual(
            asPageJson(expectedFirst.data),
          );
          expect(asPageJson(secondPage.items)).toEqual(
            asPageJson(expectedSecond.data),
          );
          expect(asPageJson(pagesOnly.items)).toEqual(
            asPageJson(expectedFirst.data),
          );
          expect(asPageJson(withoutAggregator.items)).toEqual(
            asPageJson(expectedFirst.data),
          );
          for (const item of [
            ...firstPage.items,
            ...secondPage.items,
            ...pagesOnly.items,
            ...withoutAggregator.items,
          ]) {
            const keys = Object.keys(JSON.parse(JSON.stringify(item.data)));
            expect(keys).not.toContain('comments');
            expect(keys).not.toContain('tag_names');
            expect(keys).not.toContain('body');
          }
        }, 30_000);
      });
    });

    // Guards that the oracles above are not vacuous.
    describe('fixture sanity', () => {
      it('matches the expected content visibility under the default list policy', async () => {
        const visible = Object.fromEntries(
          await Promise.all(
            VIEWER_NAMES.map(async (name) => [
              name,
              await pagesWithSnippet(name),
            ]),
          ),
        );

        expect(visible.guest).toEqual(['public']);
        expect(visible.other).toEqual(['public']);
        expect(visible.admin).toEqual(['public']);
        expect(visible.creator).toEqual(['owner', 'public', 'specified']);
        expect(visible.specifiedUser).toEqual(['public', 'specified']);
        expect(visible.groupMember).toEqual(['public', 'userGroup']);
        expect(visible.externalGroupMember).toEqual([
          'externalGroup',
          'public',
        ]);
      }, 30_000);

      it('a quoted phrase makes Elasticsearch highlight the body of a page the viewer cannot read', async () => {
        const viewer = await viewerOf('other');
        const [raw] = await searchService.searchKeyword(
          `"${TOKEN}"`,
          null,
          viewer.user,
          viewer.userGroups,
          { limit: 50 },
        );
        const highlighted = (
          raw.data as { _id: string; _highlight?: { body?: string[] } }[]
        )
          .filter((d) => d._highlight?.body?.[0] != null)
          .map((d) => d._id);
        expect(kindsOf(highlighted)).toContain('owner');
      }, 30_000);
    });

    describe('stored XSS in a page body', () => {
      it.each([
        { facet: 'all' as const, from: 0 },
        { facet: 'all' as const, from: 1 },
        { facet: 'pages' as const, from: 0 },
      ])('escapes the snippet exactly as page search does (facet=$facet from=$from)', async ({
        facet,
        from,
      }) => {
        const query = `"${XSS_TOKEN}"`;
        const viewer = await viewerOf('other');
        const expected = await pageSearch(query, 'other', { offset: from });
        expect(expected.data.length).toBeGreaterThan(0);
        for (const item of expected.data) {
          expect(item.meta?.elasticSearchResult?.snippet).toContain('&lt;img');
        }

        for (const service of [searchService, searchServiceWithoutAggregator]) {
          // biome-ignore lint/performance/noAwaitInLoops: two services
          const result = await service.searchByFacet(query, viewer, {
            facet,
            from,
            size: 20,
          });
          expect(asPageJson(result.items)).toEqual(asPageJson(expected.data));
          expect(JSON.stringify(result.items)).not.toContain('<img');
        }
      }, 30_000);
    });

    describe('facet=attachments never reveals hidden hits', () => {
      const responseFor = async (
        query: string,
        name: ViewerName,
        from: number,
        size: number,
      ) => {
        const viewer = await viewerOf(name);
        return searchService.searchByFacet(query, viewer, {
          facet: 'attachments',
          from,
          size,
        });
      };

      describe.each([
        { hideByOwner: false, hideByGroup: false },
        { hideByOwner: true, hideByGroup: true },
      ])('list policy hideRestrictedByOwner=$hideByOwner hideRestrictedByGroup=$hideByGroup', (policy) => {
        beforeEach(() => {
          settings.hideByOwner = policy.hideByOwner;
          settings.hideByGroup = policy.hideByGroup;
        });

        it.each([
          { name: 'guest' as const, from: 0, size: 2 },
          { name: 'guest' as const, from: 0, size: 20 },
          { name: 'guest' as const, from: 2, size: 2 },
          { name: 'other' as const, from: 0, size: 2 },
          { name: 'other' as const, from: 0, size: 20 },
        ])('$name gets the same response for a term only in unreadable attachments as for a missing term (from=$from size=$size)', async ({
          name,
          from,
          size,
        }) => {
          const probe = await responseFor(PROBE_TOKEN, name, from, size);
          const missing = await responseFor(MISSING_TOKEN, name, from, size);

          expect(probe).toEqual(missing);
          expect(probe.meta.total).toBeNull();
        }, 30_000);
      });

      it('a viewer who can read the probe pages does get those hits (the probe is not vacuous)', async () => {
        const creator = await responseFor(PROBE_TOKEN, 'creator', 0, 20);
        expect(kindsOf(creator.items.map((i) => i.data._id))).toEqual([
          'owner',
          'specified',
        ]);
        expect(creator.meta.total).toBeNull();
      }, 30_000);

      it('pages through the visible hits in order, disjointly, even when hidden hits score higher', async () => {
        const pages: (string | undefined)[][] = [];
        for (const from of [0, 2, 4, 6]) {
          // biome-ignore lint/performance/noAwaitInLoops: pages are requested one after another
          const result = await responseFor(PAGING_TOKEN, 'other', from, 2);
          expect(result.meta.primaryResultIncomplete).toBe(false);
          pages.push(result.items.map((i) => idToKind.get(String(i.data._id))));
        }

        expect(pages).toEqual([
          ['paging0', 'paging1'],
          ['paging2', 'paging3'],
          ['paging4'],
          [],
        ]);
      }, 30_000);
    });

    describe('search operators and security:disableUserPages', () => {
      const queries = (): string[] => [
        OP_TOKEN,
        `${OP_TOKEN} prefix:/attperm/${RUN}/ops/`,
        `${OP_TOKEN} -prefix:/attperm/${RUN}/ops/a`,
        `${OP_TOKEN} tag:${TAG_A}`,
        `${OP_TOKEN} -tag:${TAG_A}`,
        `${OP_TOKEN} author:${users.creator.username}`,
        `${OP_TOKEN} -author:${users.creator.username}`,
        `${OP_TOKEN} editor:${users.specifiedUser.username}`,
        `${OP_TOKEN} -editor:${users.specifiedUser.username}`,
        `${OP_TOKEN} group:${userGroupName}`,
        `${OP_TOKEN} -group:${userGroupName}`,
      ];

      describe.each([
        false,
        true,
      ])('disableUserPages=%s', (disableUserPages) => {
        beforeEach(() => {
          settings.disableUserPages = disableUserPages;
        });

        it.each([
          'guest',
          'other',
          'creator',
          'groupMember',
        ] as const)('viewer %s gets attachment hits only on pages page search returns for the same query', async (name) => {
          const viewer = await viewerOf(name);
          const operatorPageIds = OPERATOR_KINDS.map((k) => pageIds[k]);

          for (const query of queries()) {
            // biome-ignore lint/performance/noAwaitInLoops: one query at a time keeps failures readable
            const expected = await pagesWithSnippet(name, query);
            const onlyAttachments = await searchService.searchByFacet(
              query,
              viewer,
              { facet: 'attachments', from: 0, size: 20 },
            );
            const combined = await searchService.searchByFacet(query, viewer, {
              facet: 'all',
              from: 0,
              size: 20,
            });
            const secondary = await searchService.resolveAttachmentSecondary(
              query,
              viewer,
              { primaryIds: operatorPageIds },
            );

            expect({
              query,
              kinds: kindsOf(onlyAttachments.items.map((i) => i.data._id)),
            }).toEqual({ query, kinds: expected });
            expect({
              query,
              kinds: attachmentHitKinds(combined.items),
            }).toEqual({ query, kinds: expected });
            expect({
              query,
              kinds: kindsOf(Object.keys(secondary.enrichments)),
            }).toEqual({ query, kinds: expected });
          }
        }, 60_000);
      });

      it('the operator fixtures really narrow page search', async () => {
        const base = await pagesWithSnippet('groupMember', OP_TOKEN);
        expect(base).toEqual(['opA', 'opB', 'opGroup', 'opUser']);
        expect(
          await pagesWithSnippet(
            'groupMember',
            `${OP_TOKEN} prefix:/attperm/${RUN}/ops/`,
          ),
        ).toEqual(['opA', 'opB', 'opGroup']);
        expect(
          await pagesWithSnippet('groupMember', `${OP_TOKEN} tag:${TAG_A}`),
        ).toEqual(['opA']);
        expect(
          await pagesWithSnippet(
            'groupMember',
            `${OP_TOKEN} author:${users.specifiedUser.username}`,
          ),
        ).toEqual(['opB']);
        expect(
          await pagesWithSnippet(
            'groupMember',
            `${OP_TOKEN} group:${userGroupName}`,
          ),
        ).toEqual(['opGroup']);

        settings.disableUserPages = true;
        expect(await pagesWithSnippet('groupMember', OP_TOKEN)).toEqual([
          'opA',
          'opB',
          'opGroup',
        ]);
      }, 30_000);
    });

    describe('MongoDB and the page index disagree', () => {
      it.each([
        { name: 'other' as const, expected: ['driftOk'] },
        { name: 'guest' as const, expected: ['driftOk'] },
        { name: 'creator' as const, expected: ['driftGrant', 'driftOk'] },
      ])('$name gets attachment hits only for pages whose MongoDB grant also allows it', async ({
        name,
        expected,
      }) => {
        const viewer = await viewerOf(name);

        const onlyAttachments = await searchService.searchByFacet(
          DRIFT_TOKEN,
          viewer,
          { facet: 'attachments', from: 0, size: 20 },
        );
        const combined = await searchService.searchByFacet(
          DRIFT_TOKEN,
          viewer,
          { facet: 'all', from: 0, size: 20 },
        );
        const secondary = await searchService.resolveAttachmentSecondary(
          DRIFT_TOKEN,
          viewer,
          { primaryIds: DRIFT_KINDS.map((k) => pageIds[k]) },
        );

        expect(await pagesWithSnippet(name, DRIFT_TOKEN)).toEqual(expected);
        expect(kindsOf(onlyAttachments.items.map((i) => i.data._id))).toEqual(
          expected,
        );
        expect(attachmentHitKinds(combined.items)).toEqual(expected);
        expect(kindsOf(Object.keys(secondary.enrichments))).toEqual(expected);
      }, 30_000);
    });

    describe('secondary route with client-supplied page ids', () => {
      it('returns nothing for pages the viewer cannot read, unknown ids and malformed ids', async () => {
        const viewer = await viewerOf('other');

        const result = await searchService.resolveAttachmentSecondary(
          TOKEN,
          viewer,
          {
            primaryIds: [
              pageIds.owner,
              pageIds.userGroup,
              pageIds.externalGroup,
              pageIds.restricted,
              pageIds.deleted,
              new mongoose.Types.ObjectId().toString(),
              'not-an-object-id',
              '*',
              pageIds.owner,
            ],
          },
        );

        expect(result.enrichments).toEqual({});
      });

      it('rejects more than 20 distinct ids and counts duplicates once', async () => {
        const viewer = await viewerOf('creator');
        const many = Array.from({ length: 21 }, () =>
          new mongoose.Types.ObjectId().toString(),
        );

        await expect(
          searchService.resolveAttachmentSecondary(TOKEN, viewer, {
            primaryIds: many,
          }),
        ).rejects.toThrow(RangeError);

        const withDuplicates = await searchService.resolveAttachmentSecondary(
          TOKEN,
          viewer,
          {
            primaryIds: [
              ...many.slice(0, 19),
              pageIds.owner,
              pageIds.owner,
              pageIds.owner,
            ],
          },
        );
        expect(kindsOf(Object.keys(withDuplicates.enrichments))).toEqual([
          'owner',
        ]);
      });
    });

    describe('mget on the real page index', () => {
      const assertLightweightMget = async (
        client: ES8ClientDelegator | ES9ClientDelegator,
      ): Promise<void> => {
        const response = await client.mget<Record<string, unknown>>({
          index: PAGE_INDEX,
          ...mgetPagesForPermissionBody([pageIds.public, pageIds.deleted]),
        });

        const byId = Object.fromEntries(
          response.docs.map((doc) => [doc._id, doc]),
        );
        const publicDoc = byId[pageIds.public];
        expect(
          publicDoc != null && 'found' in publicDoc && publicDoc.found,
        ).toBe(true);
        const source =
          publicDoc != null && '_source' in publicDoc ? publicDoc._source : {};
        expect(source).toMatchObject({ grant: PageGrant.GRANT_PUBLIC });
        expect(Object.keys(source ?? {})).not.toContain('body');
        const deletedDoc = byId[pageIds.deleted];
        expect(
          deletedDoc != null && 'found' in deletedDoc && deletedDoc.found,
        ).toBe(false);
      };

      it('ES8ClientDelegator returns only the requested lightweight fields', async () => {
        await assertLightweightMget(
          new ES8ClientDelegator({ node: esHost }, false),
        );
      });

      // The v9 client cannot talk to an Elasticsearch 8 server.
      it('ES9ClientDelegator returns only the requested lightweight fields', async (ctx) => {
        if (esServerMajor < 9) ctx.skip();
        await assertLightweightMget(
          new ES9ClientDelegator({ node: esHost }, false),
        );
      });
    });
  },
);
