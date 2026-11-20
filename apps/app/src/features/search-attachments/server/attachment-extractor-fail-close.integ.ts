/**
 * The extractor connection closes on a bad token, a missing token, a host
 * that resolves to a cloud metadata address, and a URI the admin API must
 * refuse. The real extraction client talks to a local stand-in extractor;
 * results are read back from Elasticsearch, the failures API and the logs.
 */

import dnsPromises from 'node:dns/promises';
import { type IUserHasId, PageGrant } from '@growi/core';
import express from 'express';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';
import {
  deleteIndices,
  docsOfAttachment,
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

import type Crowi from '~/server/crowi';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
import { prisma } from '~/utils/prisma';

import { attachmentSearchAdminFactory } from './routes/apiv3/attachment-search-admin';
import { attachmentIndexNames } from './services/attachment-search-delegator-extension';

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
const PAGE_INDEX = `fix_attfail_pages_${RUN}`;
const NAMES = attachmentIndexNames(PAGE_INDEX);
const TOKEN = `integ-token-${RUN}`;
const ADMIN_MOUNT = '/_api/v3/admin/attachment-search';
const EXTRACTOR_URI_KEY = 'app:attachmentFullTextSearch:extractorUri';

describe.skipIf(process.env.ELASTICSEARCH_URI == null)(
  'extractor connection fail-close (real Elasticsearch + MongoDB)',
  () => {
    let crowi: Crowi;
    let app: express.Express;
    let extractor: FakeExtractorServer;
    let files: FixtureFileStore;
    let admin: IUserHasId;
    let pageId: string;
    const config: Record<string, unknown> = {};
    const createdAttachmentIds: string[] = [];

    let seq = 0;
    const upload = async (word: string): Promise<string> => {
      seq += 1;
      const file = await files.file(
        `failclose-${RUN}-${seq}.txt`,
        fixtureFileContent({ pages: 1, word }),
      );
      const id = await uploadAttachment(crowi, file, admin, pageId);
      createdAttachmentIds.push(id);
      return id;
    };

    const indexer = () => {
      const { attachmentSearchIndexer } = crowi;
      if (attachmentSearchIndexer == null) throw new Error('not wired');
      return attachmentSearchIndexer;
    };

    beforeAll(async () => {
      extractor = await startFakeExtractorServer();
      Object.assign(config, {
        'app:elasticsearchUri': elasticsearchUriFor(PAGE_INDEX),
        'app:attachmentFullTextSearch:timeoutMs': 10_000,
        // enabled at boot, so the index is created
        [EXTRACTOR_URI_KEY]: extractor.url,
        'app:attachmentFullTextSearch:extractorToken': TOKEN,
      });
      overrideConfig(config);

      crowi = await getInstance();
      files = await createFixtureFileStore();
      crowi.fileUploadService = files.uploader;
      await wireAttachmentSearch(crowi);

      const { User, Page } = crowi.models;
      const username = `attfail-${RUN}`.slice(0, 60);
      admin = await User.create({
        name: username,
        username,
        email: `${username}@example.com`,
        admin: true,
      });
      const page = await Page.create({
        path: `/attfail-${RUN}`,
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
      app.use(ADMIN_MOUNT, attachmentSearchAdminFactory(crowi));
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
      await crowi.models.User.deleteMany({ _id: admin?._id });
      crowi.attachmentSearchIndexer = undefined;
      crowi.attachmentReindexBatch = undefined;
      crowi.attachmentIndexOperations = undefined;
    });

    beforeEach(() => {
      config[EXTRACTOR_URI_KEY] = extractor.url;
      config['app:attachmentFullTextSearch:extractorToken'] = TOKEN;
      extractor.setReply(null);
      errorLogs.length = 0;
    });

    it('records a 401 from the extractor as serviceUnreachable, in the failure log and as an error log', async () => {
      extractor.setReply(() => ({
        status: 401,
        body: { code: 'unauthorized', message: 'invalid token' },
      }));
      const requestsBefore = extractor.requests.length;

      const id = await upload(`zzunauth${RUN}`);

      expect(extractor.requests.slice(requestsBefore)).toEqual([
        expect.objectContaining({ authorization: `Bearer ${TOKEN}` }),
      ]);
      const failures = await request(app).get(`${ADMIN_MOUNT}/failures`);
      expect(failures.status).toBe(200);
      expect(
        failures.body.items.filter(
          (item: { attachmentId: string }) => item.attachmentId === id,
        ),
      ).toEqual([
        expect.objectContaining({
          attachmentId: id,
          pageId,
          reasonCode: 'serviceUnreachable',
        }),
      ]);
      expect(errorLogs).toContainEqual({
        logger: 'growi:service:search-attachments:extractor',
        args: [
          expect.anything(),
          'attachment-text-extractor returned 401 unauthorized',
        ],
      });
      expect(JSON.stringify(errorLogs)).not.toContain(TOKEN);
      // the attachment stays findable by its name, with no content
      expect(
        (await docsOfAttachment(NAMES.alias, id)).map((d) => d._source.content),
      ).toEqual(['']);
    });

    it('does not call the extractor and reports the feature disabled while the token is unset', async () => {
      config['app:attachmentFullTextSearch:extractorToken'] = undefined;
      const requestsBefore = extractor.requests.length;

      const id = await upload(`zznotoken${RUN}`);
      const reextracted = await indexer().reindex(id);
      const configRes = await request(app).get(`${ADMIN_MOUNT}/config`);

      expect(extractor.requests.length).toBe(requestsBefore);
      expect(await docsOfAttachment(NAMES.alias, id)).toEqual([]);
      expect(reextracted.ok).toBe(false);
      expect(configRes.status).toBe(200);
      expect(configRes.body.config).toMatchObject({
        isAttachmentFullTextSearchEnabled: false,
        hasExtractorToken: false,
      });
    });

    describe('an extractor host that resolves to a cloud metadata address', () => {
      let id: string;

      beforeAll(async () => {
        config[EXTRACTOR_URI_KEY] = '';
        id = await upload(`zzrebind${RUN}`);
      });

      it('is refused before any request is sent', async () => {
        // The URI's host is the local stand-in, so a request that escaped the
        // check would be seen there rather than reach a metadata address.
        vi.spyOn(dnsPromises, 'lookup').mockResolvedValue({
          address: '169.254.169.254',
          family: 4,
        });
        const requestsBefore = extractor.requests.length;

        try {
          const result = await indexer().reindex(id);

          expect(result.outcome.kind).toBe('serviceUnreachable');
          expect(extractor.requests.length).toBe(requestsBefore);
        } finally {
          vi.mocked(dnsPromises.lookup).mockRestore();
        }
      });

      it('reaches the extractor when the host resolves elsewhere (not vacuous)', async () => {
        const requestsBefore = extractor.requests.length;

        const result = await indexer().reindex(id);

        expect(result.outcome.kind).toBe('success');
        expect(extractor.requests.length).toBe(requestsBefore + 1);
      });
    });

    describe('PUT /config', () => {
      afterAll(async () => {
        await request(app)
          .put(`${ADMIN_MOUNT}/config`)
          .send({ extractorUri: null });
      });

      it.each([
        'file:///etc/passwd',
        'ftp://extractor.example/',
        'data:text/plain,hello',
        'http://169.254.169.254/latest/meta-data/',
        'http://[fd00:ec2::254]/',
        'http://100.100.100.200/',
        'http://192.0.0.192/',
        'http://2852039166/',
      ])('refuses %s with 400 invalid_extractor_uri', async (extractorUri) => {
        const res = await request(app)
          .put(`${ADMIN_MOUNT}/config`)
          .send({ extractorUri });

        expect(res.status).toBe(400);
        expect(res.body.errors).toEqual([
          expect.objectContaining({ code: 'invalid_extractor_uri' }),
        ]);
      });

      it.each([
        'http://10.0.0.1:3000/',
        'http://attachment-text-extractor.default.svc.cluster.local/',
      ])('accepts %s', async (extractorUri) => {
        const res = await request(app)
          .put(`${ADMIN_MOUNT}/config`)
          .send({ extractorUri });

        expect(res.status).toBe(200);
      });
    });
  },
);
