import { GroupType, type IUserHasId, PageGrant } from '@growi/core';
import mongoose, { type Model } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import ExternalUserGroup from '~/features/external-user-group/server/models/external-user-group';
import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
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
import type { AttachmentSearchResultAggregator } from './attachment-search-result-aggregator';
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
const TOKEN = `zzattperm${RUN}`;
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
type PageKind = (typeof PAGE_KINDS)[number] | 'deleted';

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

describe.skipIf(esUri == null)(
  'attachment search permission (real Elasticsearch + MongoDB)',
  () => {
    let crowi: Crowi;
    let delegator: ElasticsearchDelegator;
    let searchService: SearchServiceForTest;
    let aggregator: AttachmentSearchResultAggregator;
    let esHost: string;
    let esServerMajor: number;

    const users = {} as Record<Exclude<ViewerName, 'guest'>, IUserHasId>;
    const pageIds = {} as Record<PageKind, string>;
    const idToKind = new Map<string, PageKind>();
    const listPolicy = { hideByOwner: false, hideByGroup: false };
    const createdUserGroupIds: mongoose.Types.ObjectId[] = [];
    const createdExternalGroupIds: mongoose.Types.ObjectId[] = [];

    const kindsOf = (ids: Iterable<string>): string[] =>
      sorted([...ids].map((id) => idToKind.get(id) ?? `unknown:${id}`));

    const viewerOf = (name: ViewerName) =>
      resolveAttachmentSearchViewer(name === 'guest' ? null : users[name]);

    // What the existing page search shows this viewer content of.
    const pagesWithSnippet = async (name: ViewerName): Promise<string[]> => {
      const viewer = await viewerOf(name);
      const [result, delegatorName] = await searchService.searchKeyword(
        TOKEN,
        null,
        viewer.user,
        viewer.userGroups,
        { limit: 50 },
      );
      const formatted = await searchService.formatSearchResult(
        result,
        delegatorName,
        viewer.user,
        viewer.userGroups,
      );
      return kindsOf(
        formatted.data
          .filter((item) => item.meta?.elasticSearchResult?.snippet != null)
          .map((item) => item.data._id.toString()),
      );
    };

    const refresh = async (index: string): Promise<void> => {
      const res = await fetch(`${esHost}/${index}/_refresh`, {
        method: 'POST',
      });
      expect(res.ok).toBe(true);
    };

    const seedPage = async (
      kind: PageKind,
      grant: number,
      grantedUsers: IUserHasId[] = [],
      grantedGroups: { item: mongoose.Types.ObjectId; type: GroupType }[] = [],
    ): Promise<void> => {
      const pageId = new mongoose.Types.ObjectId();
      const revision = await prisma.revisions.create({
        data: {
          pageId: pageId.toString(),
          body: `This ${kind} page mentions ${TOKEN} in its body.`,
          format: 'markdown',
          authorId: users.creator._id,
        },
      });
      const Page = mongoose.model<PageDocument, PageModel>('Page');
      await Page.insertMany([
        {
          _id: pageId,
          path: `/attperm/${RUN}/${kind}`,
          grant,
          creator: users.creator._id,
          lastUpdateUser: users.creator._id,
          grantedUsers: grantedUsers.map((u) => u._id),
          grantedGroups,
          revision: revision._id,
        },
      ]);
      pageIds[kind] = pageId.toString();
      idToKind.set(pageId.toString(), kind);
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
          return listPolicy.hideByOwner;
        }
        if (key === 'security:list-policy:hideRestrictedByGroup') {
          return listPolicy.hideByGroup;
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

      const attachmentExt = new AttachmentSearchDelegatorExtension(esClient);
      await attachmentExt.createAttachmentIndex(ATTACHMENT_INDEX);

      searchService = SearchServiceForTest.forDelegator(crowi, delegator);
      aggregator = createAttachmentSearchResultAggregator({
        searchService,
        esClient,
        attachmentIndexName: ATTACHMENT_INDEX,
        // generous limits: this suite checks permission results, not latency
        primaryTimeoutMs: 15_000,
        secondaryTimeoutMs: 15_000,
      });

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

      const userGroup = await UserGroup.create({ name: `attperm-g-${RUN}` });
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

      await seedPage('public', PageGrant.GRANT_PUBLIC);
      await seedPage('restricted', PageGrant.GRANT_RESTRICTED);
      await seedPage('owner', PageGrant.GRANT_OWNER, [users.creator]);
      await seedPage('specified', PageGrant.GRANT_SPECIFIED, [
        users.creator,
        users.specifiedUser,
      ]);
      await seedPage(
        'userGroup',
        PageGrant.GRANT_USER_GROUP,
        [],
        [{ item: userGroup._id, type: GroupType.userGroup }],
      );
      await seedPage(
        'externalGroup',
        PageGrant.GRANT_USER_GROUP,
        [],
        [{ item: externalGroup._id, type: GroupType.externalUserGroup }],
      );
      // A page whose attachments stay indexed but which is no longer in the page index.
      pageIds.deleted = new mongoose.Types.ObjectId().toString();
      idToKind.set(pageIds.deleted, 'deleted');

      const Page = mongoose.model<PageDocument, PageModel>('Page');
      // aggregate $match does not cast strings, so pass ObjectIds
      const indexed = PAGE_KINDS.map(
        (kind) => new mongoose.Types.ObjectId(pageIds[kind]),
      );
      await delegator.updateOrInsertPages(() =>
        Page.find({ _id: { $in: indexed } }),
      );

      const now = new Date().toISOString();
      const attachmentDoc = (
        pageId: string,
        attachmentId: string,
        content: string,
      ) => ({
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
      });
      for (const kind of [...PAGE_KINDS, 'deleted' as const]) {
        const attachmentId = `att-${kind}`;
        // biome-ignore lint/performance/noAwaitInLoops: a handful of fixture docs
        await attachmentExt.syncAttachmentIndexed(
          attachmentId,
          pageIds[kind],
          [
            attachmentDoc(
              pageIds[kind],
              attachmentId,
              `attached file for ${TOKEN}`,
            ),
          ],
          [ATTACHMENT_INDEX],
        );
      }
      // Does not contain the keyword: must never be returned.
      await attachmentExt.syncAttachmentIndexed(
        'att-unrelated',
        pageIds.public,
        [
          attachmentDoc(
            pageIds.public,
            'att-unrelated',
            'nothing relevant here',
          ),
        ],
        [ATTACHMENT_INDEX],
      );

      await refresh(PAGE_INDEX);
      await refresh(ATTACHMENT_INDEX);

      // Not vacuous: every indexed page really is in the page index.
      const countRes = await fetch(`${esHost}/${PAGE_INDEX}/_count`);
      expect(((await countRes.json()) as { count: number }).count).toBe(
        PAGE_KINDS.length,
      );
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

    describe.each(
      LIST_POLICIES,
    )('list policy hideRestrictedByOwner=$hideByOwner hideRestrictedByGroup=$hideByGroup', (policy) => {
      beforeEach(() => {
        listPolicy.hideByOwner = policy.hideByOwner;
        listPolicy.hideByGroup = policy.hideByGroup;
      });

      it.each(
        VIEWER_NAMES,
      )('viewer %s sees attachment hits exactly for the pages page search shows content of', async (name) => {
        const viewer = await viewerOf(name);
        const expected = await pagesWithSnippet(name);

        const onlyAttachments = await aggregator.searchPrimary(TOKEN, viewer, {
          facet: 'attachments',
          from: 0,
          size: 20,
        });
        const combined = await aggregator.searchPrimary(TOKEN, viewer, {
          facet: 'all',
          from: 0,
          size: 20,
        });
        const secondary = await aggregator.resolveSecondary(TOKEN, viewer, {
          facet: 'all',
          primaryIds: Object.values(pageIds),
        });

        expect(onlyAttachments.meta.primaryResultIncomplete).toBe(false);
        expect(kindsOf(onlyAttachments.items.map((i) => i.data._id))).toEqual(
          expected,
        );
        expect(
          kindsOf(
            combined.items
              .filter((i) => (i.meta?.attachmentHits?.length ?? 0) > 0)
              .map((i) => i.data._id),
          ),
        ).toEqual(expected);
        expect(kindsOf(Object.keys(secondary.enrichments))).toEqual(expected);

        const returnedAttachmentIds = [
          ...onlyAttachments.items,
          ...combined.items,
        ].flatMap((i) => i.meta?.attachmentHits ?? []);
        expect(returnedAttachmentIds.map((h) => h.attachmentId)).not.toContain(
          'att-unrelated',
        );
      }, 30_000);
    });

    // Guards that the oracle above is not vacuous for the default list policy.
    it('matches the expected content visibility under the default list policy', async () => {
      listPolicy.hideByOwner = false;
      listPolicy.hideByGroup = false;
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
      expect(visible.externalGroupMember).toEqual(['externalGroup', 'public']);
    }, 30_000);

    describe('secondary route with client-supplied page ids', () => {
      it('returns nothing for pages the viewer cannot read, unknown ids and malformed ids', async () => {
        const viewer = await viewerOf('other');

        const result = await aggregator.resolveSecondary(TOKEN, viewer, {
          facet: 'all',
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
        });

        expect(result.enrichments).toEqual({});
      });

      it('rejects more than 20 distinct ids and counts duplicates once', async () => {
        const viewer = await viewerOf('creator');
        const many = Array.from({ length: 21 }, () =>
          new mongoose.Types.ObjectId().toString(),
        );

        await expect(
          aggregator.resolveSecondary(TOKEN, viewer, {
            facet: 'all',
            primaryIds: many,
          }),
        ).rejects.toThrow(RangeError);

        const withDuplicates = await aggregator.resolveSecondary(
          TOKEN,
          viewer,
          {
            facet: 'all',
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
