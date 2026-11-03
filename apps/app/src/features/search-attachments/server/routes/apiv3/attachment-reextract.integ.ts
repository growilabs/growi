/**
 * POST /_api/v3/attachments/:id/reextract through the factory's real chain
 * (accessTokenParser -> loginRequiredStrictly -> excludeReadOnlyUser ->
 * feature gate -> id validation) and the real Page grant check on MongoDB.
 * Only the indexer is a mock: extraction itself is not what this verifies.
 */

import { GroupType, type IPage, type IUserHasId, PageGrant } from '@growi/core';
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { AttachmentType } from '~/server/interfaces/attachment';
import type { PageModel } from '~/server/models/page';
import UserGroup from '~/server/models/user-group';
import UserGroupRelation from '~/server/models/user-group-relation';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
import { configManager } from '~/server/service/config-manager';
import type SearchService from '~/server/service/search';
import { prisma } from '~/utils/prisma';

import type { AttachmentSearchIndexerInterface } from '../../services/attachment-search-indexer';
import { createAttachmentReextractRouter } from './attachment-reextract';

const RUN = `${process.env.VITEST_WORKER_ID ?? '1'}-${Date.now()}`;
const MOUNT = '/_api/v3/attachments';
// per request, so concurrent requests can run as different users
const USER_HEADER = 'x-reextract-test-user';

describe('POST /_api/v3/attachments/:id/reextract', () => {
  let crowi: Crowi;
  let app: express.Express;
  let featureEnabled = true;
  const indexer = mock<AttachmentSearchIndexerInterface>();

  const users = {} as Record<
    'owner' | 'other' | 'groupMember' | 'admin' | 'readOnly',
    IUserHasId
  >;
  const attachmentIds = {} as Record<
    'public' | 'owner' | 'group' | 'orphan' | 'pageGone' | 'public2',
    string
  >;
  const pageIds: string[] = [];
  let ownerPageId: string;
  let groupId: mongoose.Types.ObjectId;

  const reextract = (attachmentId: string, user?: IUserHasId) => {
    const req = request(app).post(`${MOUNT}/${attachmentId}/reextract`);
    return user == null ? req : req.set(USER_HEADER, user._id.toString());
  };

  let attachmentSeq = 0;
  const createAttachment = async (pageId: string | null): Promise<string> => {
    attachmentSeq += 1;
    const created = await prisma.attachments.create({
      data: {
        ...(pageId != null ? { pageId } : {}),
        creatorId: users.owner._id.toString(),
        fileName: `reextract-integ-${RUN}-${attachmentSeq}`,
        fileFormat: 'text/plain',
        originalName: 'a.txt',
        attachmentType: AttachmentType.WIKI_PAGE,
      },
    });
    return created.id;
  };

  beforeAll(async () => {
    crowi = await getInstance();
    const { Page, User } = crowi.models;
    addCustomFunctionToResponse(express);

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
    crowi.searchService = mock<SearchService>({ isConfigured: true });
    vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(true);

    for (const name of [
      'owner',
      'other',
      'groupMember',
      'admin',
      'readOnly',
    ] as const) {
      const username = `reextract-${name}-${RUN}`;
      // biome-ignore lint/performance/noAwaitInLoops: a handful of fixture users
      users[name] = await User.create({
        name: username,
        username,
        email: `${username}@example.com`,
        admin: name === 'admin',
        readOnly: name === 'readOnly',
      });
    }

    const group = await UserGroup.create({ name: `reextract-g-${RUN}` });
    groupId = group._id;
    await UserGroupRelation.create({
      relatedGroup: group._id,
      relatedUser: users.groupMember._id,
    });

    const createPage = async (
      kind: string,
      fields: Record<string, unknown>,
    ): Promise<string> => {
      const page = await Page.create({
        path: `/reextract-integ-${RUN}/${kind}`,
        creator: users.owner._id,
        lastUpdateUser: users.owner._id,
        ...fields,
      });
      pageIds.push(page._id.toString());
      return page._id.toString();
    };

    const publicPageId = await createPage('public', {
      grant: PageGrant.GRANT_PUBLIC,
    });
    ownerPageId = await createPage('owner', {
      grant: PageGrant.GRANT_OWNER,
      grantedUsers: [users.owner._id],
    });
    const groupPageId = await createPage('group', {
      grant: PageGrant.GRANT_USER_GROUP,
      grantedGroups: [{ item: group._id, type: GroupType.userGroup }],
    });

    attachmentIds.public = await createAttachment(publicPageId);
    attachmentIds.public2 = await createAttachment(publicPageId);
    attachmentIds.owner = await createAttachment(ownerPageId);
    attachmentIds.group = await createAttachment(groupPageId);
    attachmentIds.orphan = await createAttachment(null);
    attachmentIds.pageGone = await createAttachment(
      new mongoose.Types.ObjectId().toString(),
    );

    app = express();
    app.use(express.json());
    app.use((req: express.Request & { user?: IUserHasId }, _res, next) => {
      const id = req.header(USER_HEADER);
      req.user = Object.values(users).find((u) => u._id.toString() === id);
      next();
    });
    app.use(MOUNT, createAttachmentReextractRouter(crowi));
  }, 60_000);

  beforeEach(() => {
    featureEnabled = true;
    crowi.attachmentSearchIndexer = indexer;
    indexer.reindex.mockReset();
    indexer.reindex.mockResolvedValue({
      ok: true,
      outcome: { kind: 'success', pages: [], mimeType: 'text/plain' },
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await prisma.attachments.deleteMany({
      where: { id: { in: Object.values(attachmentIds) } },
    });
    await crowi.models.Page.deleteMany({ _id: { $in: pageIds } });
    await UserGroupRelation.deleteMany({ relatedGroup: groupId });
    await UserGroup.deleteMany({ _id: groupId });
    await crowi.models.User.deleteMany({
      _id: { $in: Object.values(users).map((u) => u._id) },
    });
    crowi.attachmentSearchIndexer = undefined;
  }, 30_000);

  describe('who may call it', () => {
    it('rejects a guest even while guests may read', async () => {
      const res = await reextract(attachmentIds.public);

      expect(res.status).toBe(403);
      expect(indexer.reindex).not.toHaveBeenCalled();
    });

    it('rejects a read-only user', async () => {
      const res = await reextract(attachmentIds.public, users.readOnly);

      expect(res.status).toBe(400);
      expect(indexer.reindex).not.toHaveBeenCalled();
    });

    it.each([
      { attachment: 'public', user: 'other' },
      { attachment: 'owner', user: 'owner' },
      { attachment: 'owner', user: 'admin' },
      { attachment: 'group', user: 'groupMember' },
    ] as const)('lets $user re-extract the $attachment page attachment', async ({
      attachment,
      user,
    }) => {
      const res = await reextract(attachmentIds[attachment], users[user]);

      expect(res.status).toBe(200);
      expect(res.body.outcome.kind).toBe('success');
      expect(indexer.reindex).toHaveBeenCalledWith(attachmentIds[attachment]);
    });

    it.each([
      { attachment: 'owner', user: 'other' },
      { attachment: 'group', user: 'other' },
      { attachment: 'orphan', user: 'other' },
      { attachment: 'pageGone', user: 'other' },
    ] as const)('refuses $user on the $attachment attachment as not found', async ({
      attachment,
      user,
    }) => {
      const res = await reextract(attachmentIds[attachment], users[user]);

      expect(res.status).toBe(404);
      // the same body whether or not the attachment or its page exists
      expect(res.body.errors).toEqual([
        expect.objectContaining({
          message: 'Attachment is not found or forbidden',
          code: 'notfound_or_forbidden',
        }),
      ]);
      expect(res.text).not.toContain(attachmentIds[attachment]);
      expect(indexer.reindex).not.toHaveBeenCalled();
    });

    it("follows the page's current grant, not an earlier answer", async () => {
      const { Page } = crowi.models;
      expect((await reextract(attachmentIds.public, users.other)).status).toBe(
        200,
      );

      const [publicPageId] = pageIds;
      await Page.updateOne(
        { _id: publicPageId },
        { grant: PageGrant.GRANT_OWNER, grantedUsers: [users.owner._id] },
      );
      try {
        expect(
          (await reextract(attachmentIds.public, users.other)).status,
        ).toBe(404);
      } finally {
        await Page.updateOne(
          { _id: publicPageId },
          { grant: PageGrant.GRANT_PUBLIC, grantedUsers: [] },
        );
      }
    });
  });

  describe('what the response tells', () => {
    const MARKER = 'zzreextractmarkerqq';

    it.each([
      { attachment: 'owner', user: 'admin' },
      { attachment: 'owner', user: 'owner' },
      { attachment: 'public', user: 'other' },
    ] as const)('gives $user only the outcome kind for the $attachment page attachment, never its text', async ({
      attachment,
      user,
    }) => {
      indexer.reindex.mockResolvedValue({
        ok: true,
        outcome: {
          kind: 'success',
          pages: [
            { pageNumber: 1, label: MARKER, content: `secret ${MARKER}` },
          ],
          mimeType: `text/${MARKER}`,
        },
      });

      const res = await reextract(attachmentIds[attachment], users[user]);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ outcome: { kind: 'success' } });
      expect(res.text).not.toContain(MARKER);
    });

    it('does not echo the message of a failed extraction', async () => {
      indexer.reindex.mockResolvedValue({
        ok: true,
        outcome: {
          kind: 'failed',
          reasonCode: 'extraction_failed',
          message: `could not read ${MARKER}`,
        },
      });

      const res = await reextract(attachmentIds.public, users.other);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ outcome: { kind: 'failed' } });
      expect(res.text).not.toContain(MARKER);
    });
  });

  describe('refusals', () => {
    it('answers a missing attachment, a missing page and an unreadable page with one 404', async () => {
      const missingId = new mongoose.Types.ObjectId().toString();
      const missing = await reextract(missingId, users.other);
      const pageGone = await reextract(attachmentIds.pageGone, users.other);
      const unreadable = await reextract(attachmentIds.owner, users.other);
      const orphan = await reextract(attachmentIds.orphan, users.other);

      expect(missing.status).toBe(404);
      expect(missing.body.errors[0].code).toBe('notfound_or_forbidden');
      expect(missing.text).not.toContain(missingId);
      for (const res of [pageGone, unreadable, orphan]) {
        expect(res.status).toBe(missing.status);
        expect(res.text).toBe(missing.text);
      }
      expect(indexer.reindex).not.toHaveBeenCalled();
    });

    it('answers a read-only user the same way whether or not the attachment exists', async () => {
      const existing = await reextract(attachmentIds.owner, users.readOnly);
      const missing = await reextract(
        new mongoose.Types.ObjectId().toString(),
        users.readOnly,
      );

      expect(existing.status).toBe(400);
      expect(missing.status).toBe(existing.status);
      expect(missing.text).toBe(existing.text);
    });

    it('answers a missing attachment with the same 404 for an admin', async () => {
      const missing = await reextract(
        new mongoose.Types.ObjectId().toString(),
        users.admin,
      );
      const unreadable = await reextract(attachmentIds.owner, users.other);

      expect(missing.status).toBe(404);
      expect(missing.text).toBe(unreadable.text);
    });
  });

  describe('concurrent requests', () => {
    const deferred = () => {
      let resolve: (
        value: Awaited<ReturnType<typeof indexer.reindex>>,
      ) => void = () => {};
      const promise = new Promise<Awaited<ReturnType<typeof indexer.reindex>>>(
        (r) => {
          resolve = r;
        },
      );
      return { promise, resolve };
    };
    const done = {
      ok: true,
      outcome: { kind: 'success', pages: [], mimeType: 'text/plain' },
    } as const;

    it('runs one extraction for concurrent requests on the same attachment', async () => {
      const running = deferred();
      indexer.reindex.mockReturnValue(running.promise);
      // both callers are authorized by the page grant check, the last step
      // before the extraction starts
      const grantCheck = vi.spyOn(
        mongoose.model<IPage, PageModel>('Page'),
        'isAccessiblePageByViewer',
      );

      let responses: Awaited<ReturnType<typeof reextract>>[];
      try {
        const first = reextract(attachmentIds.public, users.other).then(
          (r) => r,
        );
        const second = reextract(attachmentIds.public, users.owner).then(
          (r) => r,
        );
        await vi.waitFor(() =>
          expect(grantCheck.mock.settledResults).toHaveLength(2),
        );
        await new Promise(setImmediate);
        running.resolve({ ...done, outcome: { ...done.outcome, pages: [] } });
        responses = await Promise.all([first, second]);
      } finally {
        grantCheck.mockRestore();
      }

      expect(responses.map((r) => r.status)).toEqual([200, 200]);
      expect(indexer.reindex).toHaveBeenCalledTimes(1);

      // settled: the next request starts a new extraction
      indexer.reindex.mockResolvedValue({
        ...done,
        outcome: { ...done.outcome, pages: [] },
      });
      expect((await reextract(attachmentIds.public, users.other)).status).toBe(
        200,
      );
      expect(indexer.reindex).toHaveBeenCalledTimes(2);
    });

    it('refuses a new attachment with 503 while the concurrency cap is reached', async () => {
      const running = deferred();
      indexer.reindex.mockReturnValue(running.promise);

      const inFlight = (['public', 'public2', 'group'] as const).map((a) =>
        reextract(attachmentIds[a], users.admin).then((r) => r),
      );
      await vi.waitFor(() => expect(indexer.reindex).toHaveBeenCalledTimes(3));
      const refused = await reextract(attachmentIds.owner, users.admin);
      running.resolve({ ...done, outcome: { ...done.outcome, pages: [] } });
      const settled = await Promise.all(inFlight);

      expect(refused.status).toBe(503);
      expect(refused.body.errors[0].code).toBe('reextract_busy');
      expect(settled.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(indexer.reindex).toHaveBeenCalledTimes(3);
    });
  });

  describe('request and feature state', () => {
    it.each([
      'not-an-id',
      '%24ne',
    ])('answers 400 for the id %s without echoing it', async (id) => {
      const res = await reextract(id, users.admin);

      expect(res.status).toBe(400);
      expect(res.text).not.toContain(id);
    });

    it('answers 503 while the feature is disabled', async () => {
      featureEnabled = false;

      const res = await reextract(attachmentIds.public, users.admin);

      expect(res.status).toBe(503);
      expect(res.body.errors[0].code).toBe('feature_disabled');
    });

    it('answers 503 when the feature was enabled after boot (no indexer yet)', async () => {
      crowi.attachmentSearchIndexer = undefined;

      const res = await reextract(attachmentIds.public, users.admin);

      expect(res.status).toBe(503);
      expect(res.body.errors[0].code).toBe('feature_disabled');
    });
  });
});
