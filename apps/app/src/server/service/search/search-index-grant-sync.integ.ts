import { type IUserHasId, PageGrant } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { RevisionConflictError } from '~/server/models/errors';
import type { PageDocument, PageModel } from '~/server/models/page';
import { configManager } from '~/server/service/config-manager';
import SearchService from '~/server/service/search';
import SyncPageStatusService from '~/server/service/system-events/sync-page-status';
import { prisma } from '~/utils/prisma';

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const PATH_PREFIX = `/search-index-grant-sync-integ-${WORKER_ID}`;
const USERNAME = `search-index-grant-sync-integ-${WORKER_ID}`;

// ELASTICSEARCH_URI is mapped from VITE_ELASTICSEARCH_URI by test/setup/elasticsearch.ts
const sharedElasticsearchUri = process.env.ELASTICSEARCH_URI;
// A dedicated index, so the documents written here never reach a shared one.
const INDEX_NAME = `growi_test_search_index_grant_sync_${WORKER_ID}`;

describe.skipIf(sharedElasticsearchUri == null)(
  'Search index after a page update that narrows the grant',
  () => {
    let crowi: Crowi;
    let Page: PageModel;
    let user: HydratedDocument<IUserHasId>;
    let searchService: SearchService;
    let elasticsearchHost: string;
    let isV5CompatibleBefore: boolean;

    const createIndexedPublicPage = async (
      name: string,
      onTree: boolean,
      parentPage?: PageDocument,
    ): Promise<HydratedDocument<PageDocument>> => {
      const root = await Page.findOne({ path: '/' }).orFail();
      const page = await Page.create({
        path: `${PATH_PREFIX}/${name}`,
        grant: PageGrant.GRANT_PUBLIC,
        creator: user._id,
        lastUpdateUser: user._id,
        parent: onTree ? (parentPage?._id ?? root._id) : null,
      });
      const revision = await prisma.revisions.create({
        data: {
          pageId: String(page._id),
          body: 'initial body',
          format: 'markdown',
          authorId: String(user._id),
        },
      });
      page.revision = revision.id;
      await page.save();

      await searchService.fullTextSearchDelegator.syncPageUpdated(page, user);
      await expect
        .poll(() => indexedGrantOf(page), { timeout: 10_000 })
        .toBe(PageGrant.GRANT_PUBLIC);
      return page;
    };

    /** The grant stored in the page's index document; undefined when absent. */
    const indexedGrantOf = async (
      page: PageDocument,
    ): Promise<number | undefined> => {
      await fetch(`${elasticsearchHost}/${INDEX_NAME}*/_refresh`, {
        method: 'POST',
      });
      const res = await fetch(
        `${elasticsearchHost}/${INDEX_NAME}*/_search?q=_id:${page._id}&_source=grant`,
      );
      const json: { hits?: { hits?: Array<{ _source: { grant: number } }> } } =
        await res.json();
      return json.hits?.hits?.[0]?._source.grant;
    };

    beforeAll(async () => {
      const uri = new URL(sharedElasticsearchUri ?? '');
      elasticsearchHost = `${uri.protocol}//${uri.host}`;
      process.env.ELASTICSEARCH_URI = `${elasticsearchHost}/${INDEX_NAME}`;
      await configManager.loadConfigs();

      crowi = await getInstance();
      Page = mongoose.model<PageDocument, PageModel>('Page');
      // Pages on the tree take the v5 update path; the others the legacy one.
      isV5CompatibleBefore = configManager.getConfig('app:isV5Compatible');
      await configManager.updateConfig('app:isV5Compatible', true);

      await crowi.models.User.deleteMany({ username: USERNAME });
      user = await crowi.models.User.create({
        name: USERNAME,
        username: USERNAME,
        email: `${USERNAME}@example.com`,
      });
      if ((await Page.findOne({ path: '/' })) == null) {
        await Page.create({ path: '/', grant: PageGrant.GRANT_PUBLIC });
      }

      // Same listener order as the running app: the page-status broadcaster
      // is registered before the search service.
      new SyncPageStatusService(crowi, undefined, crowi.socketIoService);
      searchService = await SearchService.create(crowi);
    }, 120_000);

    afterAll(async () => {
      vi.restoreAllMocks();
      // Elasticsearch rejects wildcards on index deletion by default.
      await fetch(
        `${elasticsearchHost}/${INDEX_NAME},${INDEX_NAME}-tmp?ignore_unavailable=true`,
        { method: 'DELETE' },
      );
      process.env.ELASTICSEARCH_URI = sharedElasticsearchUri;
      await configManager.loadConfigs();
      await configManager.updateConfig(
        'app:isV5Compatible',
        isV5CompatibleBefore,
      );

      const pages = await Page.find({ path: { $regex: `^${PATH_PREFIX}/` } });
      const pageIds = pages.map((page) => String(page._id));
      await prisma.revisions.deleteMany({ where: { pageId: { in: pageIds } } });
      await Page.deleteMany({ _id: { $in: pageIds } });
      await crowi.models.User.deleteMany({ username: USERNAME });
    });

    it('stores the new grant after a grant-only update', async () => {
      const page = await createIndexedPublicPage('grant-only', true);

      await crowi.pageService.updateGrant(page, user, {
        grant: PageGrant.GRANT_OWNER,
        userRelatedGrantedGroups: [],
      });

      await expect
        .poll(() => indexedGrantOf(page), { timeout: 10_000 })
        .toBe(PageGrant.GRANT_OWNER);
    }, 30_000);

    it.each([
      { name: 'descendants-on-tree', onTree: true },
      { name: 'descendants-legacy', onTree: false },
    ])('stores the new grant of a descendant when the grant is applied to descendants ($name)', async ({
      name,
      onTree,
    }) => {
      const parent = await createIndexedPublicPage(name, onTree);
      const child = await createIndexedPublicPage(
        `${name}/child`,
        onTree,
        parent,
      );

      await crowi.pageService.updatePage(parent, null, null, user, {
        grant: PageGrant.GRANT_OWNER,
        overwriteScopesOfDescendants: true,
      });

      await expect
        .poll(async () => (await Page.findById(child._id))?.grant, {
          timeout: 10_000,
        })
        .toBe(PageGrant.GRANT_OWNER);
      await expect
        .poll(() => indexedGrantOf(child), { timeout: 10_000 })
        .toBe(PageGrant.GRANT_OWNER);
      expect(await indexedGrantOf(parent)).toBe(PageGrant.GRANT_OWNER);
    }, 30_000);

    it.each([
      { name: 'conflict-on-tree', onTree: true },
      { name: 'conflict-legacy', onTree: false },
    ])('stores the new grant when the body save then loses a revision conflict ($name)', async ({
      name,
      onTree,
    }) => {
      const page = await createIndexedPublicPage(name, onTree);

      await expect(
        crowi.pageService.updatePage(
          page,
          'updated body',
          'initial body',
          user,
          {
            grant: PageGrant.GRANT_OWNER,
            expectedRevisionId: new mongoose.Types.ObjectId().toString(),
          },
        ),
      ).rejects.toThrow(RevisionConflictError);

      await expect
        .poll(() => indexedGrantOf(page), { timeout: 10_000 })
        .toBe(PageGrant.GRANT_OWNER);
    }, 30_000);
  },
);
