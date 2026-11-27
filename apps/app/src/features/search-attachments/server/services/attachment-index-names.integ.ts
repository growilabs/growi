/**
 * Attachment index names on a real Elasticsearch shared by several GROWI
 * apps: each app's alias and indices follow its page index name, and a write
 * through a missing alias never creates an index under the alias's name.
 */

import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import { getInstance } from '^/test/setup/crowi';
import {
  aliasTargets,
  countDocs,
  deleteIndices,
  indexExists,
  uniqueRunToken,
} from '^/test/setup/search-attachments/es-inspection';

import { AttachmentType } from '~/server/interfaces/attachment';
import { configManager } from '~/server/service/config-manager';
import ElasticsearchDelegator from '~/server/service/search-delegator/elasticsearch';
import { getClient } from '~/server/service/search-delegator/elasticsearch.testing';
import { prisma } from '~/utils/prisma';

import {
  type AttachmentIndexNames,
  AttachmentSearchDelegatorExtension,
  attachmentIndexNames,
} from './attachment-search-delegator-extension';
import {
  AttachmentSearchIndexer,
  type ReindexBatchRef,
} from './attachment-search-indexer';
import type { AttachmentTextExtractorService } from './attachment-text-extractor';
import type { ExtractionFailureLogServiceInterface } from './extraction-failure-log-service';

const errorLogs = vi.hoisted(
  () => [] as { readonly logger: string; readonly args: unknown[] }[],
);
vi.mock('~/utils/logger', () => ({
  default: (name: string) => ({
    warn: vi.fn(),
    error: (...args: unknown[]) => {
      errorLogs.push({ logger: name, args });
    },
    debug: vi.fn(),
    info: vi.fn(),
  }),
}));

const RUN = uniqueRunToken();
// Every case has tenants of its own: vitest does not stop a timed-out test,
// so a shared tenant could still be rebuilt while the next case reads it.
// Within a pair, one page index name is a prefix of the other.
const tenantPair = (prefix: string) => ({
  shorter: `fix_attnames_${RUN}${prefix}`,
  longer: `fix_attnames_${RUN}${prefix}b`,
});
const PAIR_1 = tenantPair('x');
const PAIR_2 = tenantPair('y');
const CASES = [
  { acting: PAIR_1.shorter, other: PAIR_1.longer },
  { acting: PAIR_2.longer, other: PAIR_2.shorter },
];
const NO_ALIAS_WRITE = `fix_attnames_${RUN}c`;
const NO_ALIAS_DELETE = `fix_attnames_${RUN}d`;

describe.skipIf(process.env.ELASTICSEARCH_URI == null)(
  'attachment index names (real Elasticsearch)',
  () => {
    let client: ReturnType<typeof getClient>;
    const createdAttachmentIds: string[] = [];
    const allNames = [
      PAIR_1.shorter,
      PAIR_1.longer,
      PAIR_2.shorter,
      PAIR_2.longer,
      NO_ALIAS_WRITE,
      NO_ALIAS_DELETE,
    ].map(attachmentIndexNames);

    const extensionFor = (names: AttachmentIndexNames) =>
      new AttachmentSearchDelegatorExtension(client, names);

    const docFor = (attachmentId: string, pageId: string) => {
      const now = new Date().toISOString();
      return {
        attachmentId,
        pageId,
        pageNumber: 1,
        label: null,
        fileName: 'a.txt',
        originalName: 'a.txt',
        fileFormat: 'text/plain',
        fileSize: 1,
        attachmentType: 'WIKI_PAGE',
        content: 'kept',
        created_at: now,
        updated_at: now,
      };
    };

    /** Everything Elasticsearch holds under one app's attachment names. */
    const snapshot = async (names: AttachmentIndexNames) => ({
      alias: await aliasTargets(names.alias),
      indices: await Promise.all(names.indices.map(indexExists)),
      docs: await countDocs(names.alias),
    });

    beforeAll(async () => {
      const crowi = await getInstance();
      const delegator = new ElasticsearchDelegator(crowi.socketIoService);
      await delegator.initClient();
      client = getClient(delegator);

      // Each case's untouched tenant holds an alias, an index and one doc
      await Promise.all(
        CASES.map(async ({ other }) => {
          const names = attachmentIndexNames(other);
          const ext = extensionFor(names);
          await ext.ensureAttachmentIndex();
          await ext.syncAttachmentIndexed(
            `${other}-att`,
            'page',
            [docFor(`${other}-att`, 'page')],
            names.alias,
          );
        }),
      );
    });

    afterAll(async () => {
      vi.restoreAllMocks();
      await prisma.attachments.deleteMany({
        where: { id: { in: createdAttachmentIds } },
      });
      await deleteIndices(allNames.flatMap((names) => names.indices));
      await deleteIndices(allNames.map((names) => names.alias));
    });

    it.each(
      CASES,
    )('creating and rebuilding the attachment index of $acting leaves $other untouched', async ({
      acting,
      other,
    }) => {
      const actingNames = attachmentIndexNames(acting);
      const otherNames = attachmentIndexNames(other);
      const actingExt = extensionFor(actingNames);
      const before = await snapshot(otherNames);
      expect(before.docs).toBe(1);

      await actingExt.ensureAttachmentIndex();
      const rebuilt = await actingExt.createRebuildIndex();
      await actingExt.swapAttachmentAlias(rebuilt);
      const abandoned = await actingExt.createRebuildIndex();
      await actingExt.dropRebuildIndex(abandoned);

      expect(await aliasTargets(actingNames.alias)).toEqual([rebuilt]);
      expect(await indexExists(abandoned)).toBe(false);
      expect(await snapshot(otherNames)).toEqual(before);
      // Seven real Elasticsearch round-trips (ensure/create/swap/create/drop +
      // two snapshot reads); the default testTimeout is sometimes too tight
      // for that under ordinary CI contention.
    }, 30_000);

    describe('while the alias does not exist', () => {
      const indexerWith = (extension: AttachmentSearchDelegatorExtension) =>
        new AttachmentSearchIndexer({
          extractor: mock<AttachmentTextExtractorService>({
            extractAttachment: async () => ({
              kind: 'success',
              pages: [{ pageNumber: 1, label: null, content: 'text' }],
              mimeType: 'text/plain',
            }),
          }),
          delegatorExt: extension,
          failureLog: mock<ExtractionFailureLogServiceInterface>(),
          reindexBatch: mock<ReindexBatchRef>({ isRebuilding: () => false }),
          searchService: { isConfigured: true },
        });

      beforeEach(() => {
        errorLogs.length = 0;
        const originalGetConfig = configManager.getConfig.bind(configManager);
        vi.spyOn(configManager, 'getConfig').mockImplementation(
          (key, source) =>
            key === 'app:attachmentFullTextSearch:extractorUri' ||
            key === 'app:attachmentFullTextSearch:extractorToken'
              ? ('configured' as never)
              : originalGetConfig(key, source),
        );
      });

      it('fails a write into a logged error without creating an index named like the alias', async () => {
        const names = attachmentIndexNames(NO_ALIAS_WRITE);
        const indexer = indexerWith(extensionFor(names));
        const attachment = await prisma.attachments.create({
          data: {
            pageId: new mongoose.Types.ObjectId().toString(),
            creatorId: new mongoose.Types.ObjectId().toString(),
            fileName: `attnames-${RUN}.txt`,
            originalName: `attnames-${RUN}.txt`,
            fileFormat: 'text/plain',
            fileSize: 1,
            attachmentType: AttachmentType.WIKI_PAGE,
          },
        });
        createdAttachmentIds.push(attachment.id);

        await expect(
          indexer.onAttach(
            attachment.pageId,
            attachment,
            mock<Express.Multer.File>(),
          ),
        ).resolves.toBeUndefined();

        expect(errorLogs).toContainEqual({
          logger: 'growi:service:search-attachments:indexer',
          args: [
            expect.objectContaining({
              attachmentId: attachment.id,
              err: expect.objectContaining({
                message: expect.stringContaining('require_alias'),
              }),
            }),
            'onAttach: unexpected error during attachment indexing',
          ],
        });
        expect(await indexExists(names.alias)).toBe(false);
        expect(await aliasTargets(names.alias)).toEqual([]);
        // the alias can still be created afterwards
        await extensionFor(names).ensureAttachmentIndex();
        expect(await aliasTargets(names.alias)).toEqual([names.indices[0]]);
        await deleteIndices(names.indices);
      });

      it('lets a delete pass without creating anything', async () => {
        const names = attachmentIndexNames(NO_ALIAS_DELETE);
        const indexer = indexerWith(extensionFor(names));

        await expect(
          indexer.onDetach(`${NO_ALIAS_DELETE}-gone`),
        ).resolves.toBeUndefined();

        expect(errorLogs).toEqual([]);
        expect(await indexExists(names.alias)).toBe(false);
        expect(await aliasTargets(names.alias)).toEqual([]);
      });
    });
  },
);
