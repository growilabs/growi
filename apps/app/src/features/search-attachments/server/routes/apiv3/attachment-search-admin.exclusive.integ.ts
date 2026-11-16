/**
 * `requiresReindex` of GET /_api/v3/admin/attachment-search/config, against
 * real MongoDB and Elasticsearch. The feature is enabled and changed through
 * PUT /config, as an admin does.
 *
 * Exclusive: the value counts every attachment in the database, so this file
 * empties the attachments collection and must not share it.
 */

import { type IUserHasId, PageGrant } from '@growi/core';
import express from 'express';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';
import {
  countDocs,
  deleteIndices,
  uniqueRunToken,
} from '^/test/setup/search-attachments/es-inspection';
import {
  type FakeExtractorServer,
  startFakeExtractorServer,
} from '^/test/setup/search-attachments/fake-extractor-server';
import {
  createFixtureFileStore,
  elasticsearchUriFor,
  type FixtureFileStore,
  overrideConfig,
  wireAttachmentSearch,
} from '^/test/setup/search-attachments/wire-attachment-search';

import type Crowi from '~/server/crowi';
import { AttachmentType } from '~/server/interfaces/attachment';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
import { prisma } from '~/utils/prisma';

import { attachmentIndexNames } from '../../services/attachment-search-delegator-extension';
import { attachmentSearchAdminFactory } from './attachment-search-admin';

vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  }),
}));

const RUN = uniqueRunToken();
const PAGE_INDEX = `fix_attreq_pages_${RUN}`;
const NAMES = attachmentIndexNames(PAGE_INDEX);
const MOUNT = '/_api/v3/admin/attachment-search';
const ATTACHMENT_COUNT = 3;

describe.skipIf(process.env.ELASTICSEARCH_URI == null)(
  'requiresReindex (real Elasticsearch + MongoDB)',
  () => {
    let crowi: Crowi;
    let app: express.Express;
    let extractor: FakeExtractorServer;
    let files: FixtureFileStore;
    let admin: IUserHasId;
    let pageId: string;

    const requiresReindex = async (): Promise<boolean> => {
      const res = await request(app).get(`${MOUNT}/config`);
      expect(res.status).toBe(200);
      return res.body.config.requiresReindex;
    };

    const putConfig = async (body: Record<string, unknown>): Promise<void> => {
      const res = await request(app).put(`${MOUNT}/config`).send(body);
      expect(res.status).toBe(200);
    };

    let seq = 0;
    const createAttachments = async (count: number): Promise<void> => {
      for (let i = 0; i < count; i++) {
        seq += 1;
        // biome-ignore lint/performance/noAwaitInLoops: a handful of fixture rows
        await prisma.attachments.create({
          data: {
            pageId,
            creatorId: admin._id.toString(),
            fileName: `attreq-${RUN}-${seq}.txt`,
            originalName: `attreq-${RUN}-${seq}.txt`,
            fileFormat: 'text/plain',
            fileSize: 10,
            attachmentType: AttachmentType.WIKI_PAGE,
          },
        });
      }
    };

    const rebuild = async (): Promise<void> => {
      const batch = crowi.attachmentReindexBatch;
      if (batch == null) throw new Error('not wired');
      expect(batch.startRebuild(async () => {})).toBe(true);
      await vi.waitFor(() => expect(batch.isRebuilding()).toBe(false), {
        timeout: 30_000,
        interval: 50,
      });
    };

    beforeAll(async () => {
      extractor = await startFakeExtractorServer();
      // Only the page index name is fixed; the extractor settings live in the
      // database and change through PUT /config.
      overrideConfig({
        'app:elasticsearchUri': elasticsearchUriFor(PAGE_INDEX),
      });

      crowi = await getInstance();
      await crowi.configManager.updateConfigs(
        {
          'app:attachmentFullTextSearch:extractorUri': undefined,
          'app:attachmentFullTextSearch:extractorToken': undefined,
        },
        { removeIfUndefined: true },
      );
      files = await createFixtureFileStore();
      crowi.fileUploadService = files.uploader;
      await wireAttachmentSearch(crowi);
      await prisma.attachments.deleteMany({});

      const { User, Page } = crowi.models;
      const username = `attreq-${RUN}`.slice(0, 60);
      admin = await User.create({
        name: username,
        username,
        email: `${username}@example.com`,
        admin: true,
      });
      const page = await Page.create({
        path: `/attreq-${RUN}`,
        grant: PageGrant.GRANT_PUBLIC,
        creator: admin._id,
        lastUpdateUser: admin._id,
      });
      pageId = page._id.toString();

      addCustomFunctionToResponse(express);
      app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: IUserHasId }, _res, next) => {
        req.user = admin;
        next();
      });
      app.use(MOUNT, attachmentSearchAdminFactory(crowi));
    }, 60_000);

    afterAll(async () => {
      await extractor?.close();
      vi.restoreAllMocks();
      await deleteIndices(NAMES.indices);
      await prisma.attachments.deleteMany({});
      await files?.cleanup();
      if (crowi == null) return;
      // The exclusive DB is shared: leave none of the settings this file wrote
      await crowi.configManager.updateConfigs(
        {
          'app:attachmentFullTextSearch:extractorUri': undefined,
          'app:attachmentFullTextSearch:extractorToken': undefined,
          'app:attachmentFullTextSearch:timeoutMs': undefined,
        },
        { removeIfUndefined: true },
      );
      await crowi.models.Page.deleteMany({ _id: pageId });
      await crowi.models.User.deleteMany({ _id: admin?._id });
      crowi.attachmentSearchIndexer = undefined;
      crowi.attachmentReindexBatch = undefined;
      crowi.attachmentIndexOperations = undefined;
    }, 30_000);

    // One admin's sequence of states; each step builds on the one before.
    it('follows the feature being enabled, the index being rebuilt and the attachments going away', async () => {
      await createAttachments(ATTACHMENT_COUNT);

      // Disabled: false although the attachment alias does not even exist,
      // which an Elasticsearch query would answer with true
      expect(await requiresReindex()).toBe(false);

      // Enabled through the admin API: the index exists but holds nothing yet
      await putConfig({
        extractorUri: extractor.url,
        extractorToken: 'integ-token',
      });
      expect(await countDocs(NAMES.alias)).toBe(0);
      expect(await requiresReindex()).toBe(true);

      // Rebuilt: every attachment is indexed, but the answer is cached
      await rebuild();
      expect(await countDocs(NAMES.alias)).toBe(ATTACHMENT_COUNT);
      expect(await requiresReindex()).toBe(true);

      // A successful PUT drops the cached answer
      await putConfig({ timeoutMs: 20_000 });
      expect(await requiresReindex()).toBe(false);

      // No attachments left and no index: false without asking Elasticsearch
      await prisma.attachments.deleteMany({});
      // PUT re-creates the index while enabled, so it is dropped afterwards
      await putConfig({ timeoutMs: 30_000 });
      await deleteIndices(NAMES.indices);
      expect(await requiresReindex()).toBe(false);

      // An attachment again, still no index: the missing alias asks for a rebuild
      await createAttachments(1);
      await putConfig({ timeoutMs: 40_000 });
      await deleteIndices(NAMES.indices);
      expect(await requiresReindex()).toBe(true);
    }, 60_000);
  },
);
