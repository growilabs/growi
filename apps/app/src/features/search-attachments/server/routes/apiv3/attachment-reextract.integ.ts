/**
 * POST /_api/v3/attachments/:id/reextract through the factory's real chain
 * (accessTokenParser -> loginRequiredStrictly -> excludeReadOnlyUser ->
 * feature gate -> id validation) and the real Page grant check on MongoDB.
 * Only the indexer is a mock: extraction itself is not what this verifies.
 */

import { GroupType, type IUserHasId, PageGrant } from '@growi/core';
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { AttachmentType } from '~/server/interfaces/attachment';
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

describe('POST /_api/v3/attachments/:id/reextract', () => {
  let crowi: Crowi;
  let app: express.Express;
  let currentUser: IUserHasId | undefined;
  let featureEnabled = true;
  const indexer = mock<AttachmentSearchIndexerInterface>();

  const users = {} as Record<
    'owner' | 'other' | 'groupMember' | 'admin' | 'readOnly',
    IUserHasId
  >;
  const attachmentIds = {} as Record<
    'public' | 'owner' | 'group' | 'orphan' | 'pageGone',
    string
  >;
  const pageIds: string[] = [];
  let ownerPageId: string;
  let groupId: mongoose.Types.ObjectId;

  const reextract = (attachmentId: string, user?: IUserHasId) => {
    currentUser = user;
    return request(app).post(`${MOUNT}/${attachmentId}/reextract`);
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
    attachmentIds.owner = await createAttachment(ownerPageId);
    attachmentIds.group = await createAttachment(groupPageId);
    attachmentIds.orphan = await createAttachment(null);
    attachmentIds.pageGone = await createAttachment(
      new mongoose.Types.ObjectId().toString(),
    );

    app = express();
    app.use(express.json());
    app.use((req: express.Request & { user?: IUserHasId }, _res, next) => {
      req.user = currentUser;
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
    ] as const)('forbids $user on the $attachment attachment', async ({
      attachment,
      user,
    }) => {
      const res = await reextract(attachmentIds[attachment], users[user]);

      expect(res.status).toBe(403);
      // the same body whether or not the page exists
      expect(res.body.errors).toEqual([
        expect.objectContaining({
          message: 'Forbidden: insufficient permission',
          code: 'forbidden',
        }),
      ]);
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
        ).toBe(403);
      } finally {
        await Page.updateOne(
          { _id: publicPageId },
          { grant: PageGrant.GRANT_PUBLIC, grantedUsers: [] },
        );
      }
    });
  });

  describe('request and feature state', () => {
    it('answers 404 for an attachment that does not exist', async () => {
      const res = await reextract(
        new mongoose.Types.ObjectId().toString(),
        users.admin,
      );

      expect(res.status).toBe(404);
    });

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
