/**
 * Uploads and deletes go through the real AttachmentService, whose handlers
 * are registered by the real `initAttachmentFullTextSearch`, the real
 * extraction client talks to a local stand-in extractor, and every write
 * lands in a real Elasticsearch index of this test's own.
 */

import { type IUserHasId, PageGrant } from '@growi/core';

import { getInstance } from '^/test/setup/crowi';
import {
  aliasTargets,
  deleteIndices,
  docsOfAttachment,
  elasticsearchOrigin,
  setWriteBlock,
  uniqueRunToken,
} from '^/test/setup/search-attachments/es-inspection';
import {
  type FakeExtractorServer,
  fixtureFileContent,
  startFakeExtractorServer,
} from '^/test/setup/search-attachments/fake-extractor-server';
import {
  createFixtureFileStore,
  elasticsearchUriFor,
  type FixtureFileStore,
  overrideConfig,
  uploadAttachment,
  wireAttachmentSearch,
} from '^/test/setup/search-attachments/wire-attachment-search';

import { SocketEventName } from '~/interfaces/websocket';
import type Crowi from '~/server/crowi';
import { prisma } from '~/utils/prisma';

import { attachmentIndexNames } from './services/attachment-search-delegator-extension';

vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  }),
}));

const RUN = uniqueRunToken();
const PAGE_INDEX = `fix_attlife_pages_${RUN}`;
const NAMES = attachmentIndexNames(PAGE_INDEX);

// Every field an attachment doc may hold; permissions are looked up at query time.
const DOC_FIELDS = [
  'attachmentId',
  'attachmentType',
  'content',
  'created_at',
  'fileFormat',
  'fileName',
  'fileSize',
  'label',
  'originalName',
  'pageId',
  'pageNumber',
  'updated_at',
];

describe.skipIf(process.env.ELASTICSEARCH_URI == null)(
  'attachment indexing on upload, delete and rebuild (real Elasticsearch + MongoDB)',
  () => {
    let crowi: Crowi;
    let extractor: FakeExtractorServer;
    let files: FixtureFileStore;
    let user: IUserHasId;
    let pageId: string;
    const config: Record<string, unknown> = {};
    const emitted: { event: string; payload: unknown }[] = [];
    const createdAttachmentIds: string[] = [];

    let seq = 0;
    const upload = async (
      content: string,
      onPage: string | null = pageId,
    ): Promise<string> => {
      seq += 1;
      const file = await files.file(`lifecycle-${RUN}-${seq}.txt`, content);
      const id = await uploadAttachment(crowi, file, user, onPage);
      createdAttachmentIds.push(id);
      return id;
    };

    // Saved while the feature is off, so only a rebuild scan extracts it
    const uploadUnindexed = async (content: string): Promise<string> => {
      config['app:attachmentFullTextSearch:extractorUri'] = '';
      try {
        return await upload(content);
      } finally {
        config['app:attachmentFullTextSearch:extractorUri'] = extractor.url;
      }
    };

    const remove = (attachmentId: string): Promise<void> =>
      crowi.attachmentService.removeAttachment(attachmentId);

    const batch = () => {
      const { attachmentReindexBatch } = crowi;
      if (attachmentReindexBatch == null) throw new Error('not wired');
      return attachmentReindexBatch;
    };

    const rebuildIndex = () => {
      const tmp = batch().getTmpIndexName();
      if (tmp == null) throw new Error('no rebuild index yet');
      return tmp;
    };

    const waitForRebuildToEnd = () =>
      vi.waitFor(() => expect(batch().isRebuilding()).toBe(false), {
        timeout: 3_000,
        interval: 50,
      });

    const emittedEvents = () => emitted.map((e) => e.event);

    beforeAll(async () => {
      extractor = await startFakeExtractorServer();
      Object.assign(config, {
        'app:elasticsearchUri': elasticsearchUriFor(PAGE_INDEX),
        'app:attachmentFullTextSearch:extractorUri': extractor.url,
        'app:attachmentFullTextSearch:extractorToken': 'integ-token',
        'app:attachmentFullTextSearch:timeoutMs': 10_000,
      });
      overrideConfig(config);

      crowi = await getInstance();
      files = await createFixtureFileStore();
      crowi.fileUploadService = files.uploader;
      await wireAttachmentSearch(crowi);

      const adminSocket = crowi.socketIoService.getAdminSocket();
      const emit = adminSocket.emit.bind(adminSocket);
      vi.spyOn(adminSocket, 'emit').mockImplementation((event, ...args) => {
        emitted.push({ event: String(event), payload: args[0] });
        return emit(event, ...args);
      });

      const { User, Page } = crowi.models;
      const username = `attlife-${RUN}`.slice(0, 60);
      user = await User.create({
        name: username,
        username,
        email: `${username}@example.com`,
      });
      const page = await Page.create({
        path: `/attlife-${RUN}`,
        grant: PageGrant.GRANT_PUBLIC,
        creator: user._id,
        lastUpdateUser: user._id,
      });
      pageId = page._id.toString();
    });

    afterAll(async () => {
      await extractor?.close();
      vi.restoreAllMocks();
      await deleteIndices(NAMES.indices);
      await prisma.attachments.deleteMany({
        where: { id: { in: createdAttachmentIds } },
      });
      await files?.cleanup();
      if (crowi == null) return;
      await crowi.models.Page.deleteMany({ _id: pageId });
      await crowi.models.User.deleteMany({ _id: user?._id });
      crowi.attachmentSearchIndexer = undefined;
      crowi.attachmentReindexBatch = undefined;
      crowi.attachmentIndexOperations = undefined;
    });

    beforeEach(() => {
      config['app:attachmentFullTextSearch:extractorUri'] = extractor.url;
      extractor.setReply(null);
      emitted.length = 0;
    });

    describe('upload and delete', () => {
      it('indexes one doc per extracted page, without permission fields', async () => {
        const requestsBefore = extractor.requests.length;

        const id = await upload(
          fixtureFileContent({ pages: 3, word: `zzthree${RUN}` }),
        );

        expect(extractor.requests.length - requestsBefore).toBe(1);
        const docs = await docsOfAttachment(NAMES.alias, id);
        expect(docs.map((d) => d._source.content)).toEqual([
          `zzthree${RUN} page 1`,
          `zzthree${RUN} page 2`,
          `zzthree${RUN} page 3`,
        ]);
        for (const doc of docs) {
          expect(Object.keys(doc._source).sort()).toEqual(DOC_FIELDS);
          expect(doc._source).toMatchObject({ attachmentId: id, pageId });
        }
      });

      it('removes every doc of a deleted attachment', async () => {
        const id = await upload(
          fixtureFileContent({ pages: 2, word: `zzdel${RUN}` }),
        );
        expect(await docsOfAttachment(NAMES.alias, id)).toHaveLength(2);

        await remove(id);

        await vi.waitFor(
          async () =>
            expect(await docsOfAttachment(NAMES.alias, id)).toEqual([]),
          { timeout: 3_000, interval: 100 },
        );
      });

      it('removes the docs of an attachment deleted while the feature is disabled', async () => {
        const id = await upload(
          fixtureFileContent({ pages: 1, word: `zzdisabledel${RUN}` }),
        );
        expect(await docsOfAttachment(NAMES.alias, id)).toHaveLength(1);
        config['app:attachmentFullTextSearch:extractorUri'] = '';

        await remove(id);

        await vi.waitFor(
          async () =>
            expect(await docsOfAttachment(NAMES.alias, id)).toEqual([]),
          { timeout: 3_000, interval: 100 },
        );
      });

      it('does not call the extractor or index anything while the extractor URI is empty', async () => {
        config['app:attachmentFullTextSearch:extractorUri'] = '';
        const requestsBefore = extractor.requests.length;

        const id = await upload(
          fixtureFileContent({ pages: 1, word: `zzoff${RUN}` }),
        );

        expect(extractor.requests.length).toBe(requestsBefore);
        expect(await docsOfAttachment(NAMES.alias, id)).toEqual([]);
        // the upload itself is unaffected
        expect(
          await prisma.attachments.findUnique({ where: { id } }),
        ).toMatchObject({ id, pageId });
      });

      it('does not index an attachment that belongs to no page', async () => {
        const requestsBefore = extractor.requests.length;

        const id = await upload(
          fixtureFileContent({ pages: 1, word: `zznopage${RUN}` }),
          null,
        );

        expect(extractor.requests.length).toBe(requestsBefore);
        expect(await docsOfAttachment(NAMES.alias, id)).toEqual([]);
      });
    });

    describe('during a rebuild', () => {
      // A failed test must not leave its rebuild running into the next one
      afterEach(async () => {
        extractor.releaseAll();
        await waitForRebuildToEnd();
      });

      it('sends uploads and deletes to both indices, and the swapped alias serves the result', async () => {
        const kept = await upload(
          fixtureFileContent({ pages: 1, word: `zzkept${RUN}` }),
        );
        const deleted = await upload(
          fixtureFileContent({ pages: 1, word: `zzgone${RUN}` }),
        );
        // the scan stops here; ids grow, so the two above are already scanned
        const holdKey = `hold-a-${RUN}`;
        await uploadUnindexed(
          fixtureFileContent({ pages: 1, word: `zzheld${RUN}`, hold: holdKey }),
        );
        const scanHold = extractor.hold(holdKey);
        const [oldIndex] = await aliasTargets(NAMES.alias);

        expect(batch().startRebuild(async () => {})).toBe(true);
        await scanHold.reached;
        const tmp = rebuildIndex();
        expect(tmp).not.toBe(oldIndex);
        // a second request while running starts nothing
        expect(batch().startRebuild(async () => {})).toBe(false);

        const added = await upload(
          fixtureFileContent({ pages: 2, word: `zzadded${RUN}` }),
        );
        expect(await docsOfAttachment(oldIndex, added)).toHaveLength(2);
        expect(await docsOfAttachment(tmp, added)).toHaveLength(2);

        expect(await docsOfAttachment(tmp, deleted)).toHaveLength(1);
        await remove(deleted);
        await vi.waitFor(
          async () => {
            expect(await docsOfAttachment(oldIndex, deleted)).toEqual([]);
            expect(await docsOfAttachment(tmp, deleted)).toEqual([]);
          },
          { timeout: 3_000, interval: 100 },
        );

        scanHold.release();
        await waitForRebuildToEnd();

        expect(await aliasTargets(NAMES.alias)).toEqual([tmp]);
        expect(emittedEvents()).toContain(SocketEventName.FinishAddAttachment);
        const extension = crowi.attachmentIndexOperations;
        if (extension == null) throw new Error('not wired');
        const res = await fetch(
          `${elasticsearchOrigin()}/${NAMES.alias}/_search`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
              extension.searchAttachmentsBody(`zzadded${RUN}`, {}),
            ),
          },
        );
        const hits = (
          (await res.json()) as {
            hits: { hits: { _source: { attachmentId: string } }[] };
          }
        ).hits.hits;
        expect(new Set(hits.map((h) => h._source.attachmentId))).toEqual(
          new Set([added]),
        );
        expect(await docsOfAttachment(NAMES.alias, kept)).toHaveLength(1);
        expect(await docsOfAttachment(NAMES.alias, deleted)).toEqual([]);
      });

      it('leaves out of the new index an attachment deleted while the rebuild extracts it', async () => {
        const holdKey = `hold-b-${RUN}`;
        const victim = await uploadUnindexed(
          fixtureFileContent({
            pages: 1,
            word: `zzvictim${RUN}`,
            hold: holdKey,
          }),
        );
        const scanHold = extractor.hold(holdKey);

        batch().startRebuild(async () => {});
        await scanHold.reached;
        const tmp = rebuildIndex();
        await remove(victim);
        // the delete has run on both indices and found nothing to remove
        await vi.waitFor(
          async () => expect(await docsOfAttachment(tmp, victim)).toEqual([]),
          { timeout: 3_000, interval: 100 },
        );

        scanHold.release();
        await waitForRebuildToEnd();

        expect(await aliasTargets(NAMES.alias)).toEqual([tmp]);
        expect(await docsOfAttachment(NAMES.alias, victim)).toEqual([]);
      });

      it('keeps the live write when the write to the new index fails', async () => {
        const holdKey = `hold-c-${RUN}`;
        const holder = await uploadUnindexed(
          fixtureFileContent({
            pages: 1,
            word: `zzholder${RUN}`,
            hold: holdKey,
          }),
        );
        const scanHold = extractor.hold(holdKey);
        const [oldIndex] = await aliasTargets(NAMES.alias);

        batch().startRebuild(async () => {});
        await scanHold.reached;
        const tmp = rebuildIndex();
        await setWriteBlock(tmp, true);
        let added: string;
        try {
          // resolves like any upload: the failed write does not surface
          added = await upload(
            fixtureFileContent({ pages: 1, word: `zzblocked${RUN}` }),
          );
        } finally {
          await setWriteBlock(tmp, false);
        }

        expect(await docsOfAttachment(oldIndex, added)).toHaveLength(1);
        expect(await docsOfAttachment(tmp, added)).toEqual([]);

        scanHold.release();
        await waitForRebuildToEnd();
        expect(await docsOfAttachment(NAMES.alias, holder)).toHaveLength(1);
      });

      it('keeps the alias on the old index and clears the running flag when the page rebuild fails', async () => {
        const before = await aliasTargets(NAMES.alias);
        expect(before).toHaveLength(1);

        expect(
          batch().startRebuild(() =>
            Promise.reject(new Error('page rebuild failed')),
          ),
        ).toBe(true);
        await waitForRebuildToEnd();

        expect(await aliasTargets(NAMES.alias)).toEqual(before);
        expect(batch().getTmpIndexName()).toBeNull();
        expect(emittedEvents()).toContain(
          SocketEventName.AttachmentRebuildingFailed,
        );
        expect(emittedEvents()).not.toContain(
          SocketEventName.FinishAddAttachment,
        );
        // and the next rebuild can start
        expect(batch().startRebuild(async () => {})).toBe(true);
        await waitForRebuildToEnd();
      });
    });
  },
);
