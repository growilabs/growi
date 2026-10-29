import type { IUser } from '@growi/core';
import { PageGrant } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import express from 'express';
import mongoose, { type HydratedDocument, type Model, Types } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { setup as certifySharedPageFactory } from '~/server/middlewares/certify-shared-page';
import loginRequiredFactory from '~/server/middlewares/login-required';
import { AccessToken } from '~/server/models/access-token';
import type { PageDocument, PageModel } from '~/server/models/page';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
import { prisma } from '~/utils/prisma';

import { canViewCommentsOfPage } from './can-view-comments-of-page';

// The decision is observed behind the same middleware chain the list route
// uses (accessTokenParser -> certifySharedPage -> guest-allowed loginRequired),
// so each case is the same condition set the list route answers.

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const BASE = `/can-view-comments-integ-${WORKER_ID}`;
const MOUNT_PATH = '/_api/v3/probe';

describe('canViewCommentsOfPage', () => {
  let crowi: Crowi;
  let app: express.Application;
  let Page: PageModel;
  let User: Model<IUser>;

  let viewer: HydratedDocument<IUser>;
  let owner: HydratedDocument<IUser>;
  let currentUser: HydratedDocument<IUser> | undefined;

  let publicPageId: string;
  let privatePageId: string;
  let sharedPageId: string;
  let shareLinkId: string;
  let expiredShareLinkId: string;

  let pageReadToken: string;
  let wrongScopeToken: string;

  const probe = (query: Record<string, unknown>) =>
    request(app).get(MOUNT_PATH).query(query);

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');
    User = mongoose.model<IUser>('User');

    const viewerName = `can-view-comments-viewer-${WORKER_ID}`;
    const ownerName = `can-view-comments-owner-${WORKER_ID}`;
    await User.deleteMany({ username: { $in: [viewerName, ownerName] } });
    await Page.deleteMany({
      path: { $in: [`${BASE}/public`, `${BASE}/private`, `${BASE}/shared`] },
    });

    viewer = await User.create({
      name: viewerName,
      username: viewerName,
      email: `${viewerName}@example.com`,
    });
    owner = await User.create({
      name: ownerName,
      username: ownerName,
      email: `${ownerName}@example.com`,
    });

    // isEmpty: the basic page info only dereferences page.revision for non-empty pages.
    const createPage = (path: string, grant: PageGrant) =>
      Page.create({
        path,
        grant,
        ...(grant === PageGrant.GRANT_OWNER
          ? { grantedUsers: [owner._id] }
          : {}),
        creator: owner._id,
        lastUpdateUser: owner._id,
        isEmpty: true,
      });
    publicPageId = String(
      (await createPage(`${BASE}/public`, PageGrant.GRANT_PUBLIC))._id,
    );
    privatePageId = String(
      (await createPage(`${BASE}/private`, PageGrant.GRANT_OWNER))._id,
    );
    sharedPageId = String(
      (await createPage(`${BASE}/shared`, PageGrant.GRANT_OWNER))._id,
    );

    shareLinkId = (
      await prisma.sharelinks.create({ data: { relatedPageId: sharedPageId } })
    ).id;
    expiredShareLinkId = (
      await prisma.sharelinks.create({
        data: {
          relatedPageId: sharedPageId,
          expiredAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
        },
      })
    ).id;

    const oneDayLater = new Date(Date.now() + 1000 * 60 * 60 * 24);
    pageReadToken = (
      await AccessToken.generateToken(viewer._id, oneDayLater, [
        SCOPE.READ.FEATURES.PAGE,
      ])
    ).token;
    wrongScopeToken = (
      await AccessToken.generateToken(viewer._id, oneDayLater, [
        SCOPE.READ.USER_SETTINGS.INFO,
      ])
    ).token;

    const responseHelpers: { response: Record<string, unknown> } = {
      response: {},
    };
    addCustomFunctionToResponse(responseHelpers);

    app = express();
    app.use(express.json());
    app.use((req: CrowiRequest, res, next) => {
      Object.assign(res, responseHelpers.response);
      if (currentUser != null) {
        req.user = currentUser;
      }
      next();
    });
    // Mounted with app.use so req.baseUrl matches /_api/..., which makes
    // loginRequired answer 403 instead of redirecting to /login.
    app.use(MOUNT_PATH, [
      accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }),
      certifySharedPageFactory(crowi),
      loginRequiredFactory(crowi, true),
      async (req: CrowiRequest, res: express.Response) => {
        const viewable = await canViewCommentsOfPage(
          {
            pageService: crowi.pageService,
            pageGrantService: crowi.pageGrantService,
          },
          { req, pageId: String(req.query.pageId) },
        );
        res.json({ viewable });
      },
    ]);
  }, 120_000);

  afterAll(async () => {
    const pageIds = [publicPageId, privatePageId, sharedPageId];
    await prisma.sharelinks.deleteMany({
      where: { relatedPageId: { in: pageIds } },
    });
    await Page.deleteMany({ _id: { $in: pageIds } });
    await AccessToken.deleteAllTokensByUserId(viewer._id);
    await User.deleteMany({ _id: { $in: [viewer._id, owner._id] } });
  }, 30_000);

  beforeEach(() => {
    currentUser = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('logged-in viewer', () => {
    it('is allowed on a page the viewer can view', async () => {
      currentUser = viewer;

      const res = await probe({ pageId: publicPageId });

      expect(res.status).toBe(200);
      expect(res.body.viewable).toBe(true);
    });

    it('is denied on a page the viewer cannot view', async () => {
      currentUser = viewer;

      const res = await probe({ pageId: privatePageId });

      expect(res.status).toBe(200);
      expect(res.body.viewable).toBe(false);
    });

    it('is allowed for the owner of a private page', async () => {
      currentUser = owner;

      const res = await probe({ pageId: privatePageId });

      expect(res.body.viewable).toBe(true);
    });

    it('is denied for a page that does not exist', async () => {
      currentUser = viewer;

      const res = await probe({ pageId: String(new Types.ObjectId()) });

      expect(res.body.viewable).toBe(false);
    });
  });

  describe('guest', () => {
    it('is allowed on a guest-visible page when guest read is allowed', async () => {
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(true);

      const res = await probe({ pageId: publicPageId });

      expect(res.body.viewable).toBe(true);
    });

    it('is denied on a page the guest cannot view even when guest read is allowed', async () => {
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(true);

      const res = await probe({ pageId: privatePageId });

      expect(res.body.viewable).toBe(false);
    });

    it('never reaches the decision when guest read is disallowed', async () => {
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(false);

      const res = await probe({ pageId: publicPageId });

      expect(res.status).toBe(403);
      expect(res.body.viewable).toBeUndefined();
    });
  });

  describe('access token', () => {
    it('is allowed on a viewable page for a token with the page-read scope, even when guest read is disallowed', async () => {
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(false);

      const res = await probe({ pageId: publicPageId }).set(
        'Authorization',
        `Bearer ${pageReadToken}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.viewable).toBe(true);
    });

    it('is denied on a page the token owner cannot view', async () => {
      const res = await probe({ pageId: privatePageId }).set(
        'Authorization',
        `Bearer ${pageReadToken}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.viewable).toBe(false);
    });

    it('never reaches the decision for a token lacking the page-read scope', async () => {
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(false);

      const res = await probe({ pageId: publicPageId }).set(
        'Authorization',
        `Bearer ${wrongScopeToken}`,
      );

      expect(res.status).toBe(403);
      expect(res.body.viewable).toBeUndefined();
    });
  });

  describe('share link', () => {
    it('is allowed on the shared page for a guest, even when guest read is disallowed', async () => {
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(false);

      const res = await probe({ pageId: sharedPageId, shareLinkId });

      expect(res.status).toBe(200);
      expect(res.body.viewable).toBe(true);
    });

    it('is allowed on the shared page for a logged-in viewer who cannot view it directly', async () => {
      currentUser = viewer;

      const res = await probe({ pageId: sharedPageId, shareLinkId });

      expect(res.body.viewable).toBe(true);
    });

    it.each([
      ['a guest', false],
      ['a logged-in viewer', true],
    ])('is denied for %s using the share link of another page', async (_label, loggedIn) => {
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(true);
      currentUser = loggedIn ? viewer : undefined;

      const res = await probe({ pageId: privatePageId, shareLinkId });

      expect(res.status).toBe(200);
      expect(res.body.viewable).toBe(false);
    });

    it('does not honor a share link certified through page_id while pageId names another page', async () => {
      currentUser = viewer;

      const res = await probe({
        pageId: privatePageId,
        page_id: sharedPageId,
        shareLinkId,
      });

      expect(res.body.viewable).toBe(false);
    });

    it.each([
      ['an expired share link', () => expiredShareLinkId],
      ['a nonexistent share link', () => String(new Types.ObjectId())],
    ])('treats %s as not shared', async (_label, shareLinkIdOf) => {
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(true);

      const res = await probe({
        pageId: sharedPageId,
        shareLinkId: shareLinkIdOf(),
      });

      expect(res.status).toBe(200);
      expect(res.body.viewable).toBe(false);
    });
  });
});
