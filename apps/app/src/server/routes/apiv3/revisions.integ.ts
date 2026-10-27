/**
 * Regression test for GET /revisions/:id — the access check must be scoped
 * to the revision actually fetched, not only to the `pageId` query param.
 *
 * Real MongoDB (Page/User) + real Prisma (revisions) + the real route
 * handler exported from ./revisions. Only accessTokenParser / login-required
 * are stubbed to a passthrough (auth is not what this test verifies); the
 * real Page.isAccessiblePageByViewer and the real handler logic run
 * unmodified, mirroring the attachment-add-activity.integ.ts precedent.
 */

import type { IUserHasId } from '@growi/core';
import { PageGrant } from '@growi/core';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { prisma } from '~/utils/prisma';

import type { ApiV3Response } from './interfaces/apiv3-response';

const passthrough = (_req: Request, _res: Response, next: NextFunction) =>
  next();

vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser: () => passthrough,
}));
vi.mock('~/server/middlewares/login-required', () => ({
  default: () => passthrough,
}));

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const ACCESSIBLE_PATH = `/revisions-integ-accessible-${WORKER_ID}`;
const PRIVATE_PATH = `/revisions-integ-private-${WORKER_ID}`;
const MOUNT_PATH = '/revisions';

interface AuthorizedRequest extends Request {
  user?: IUserHasId;
}

describe('GET /revisions/:id — revision must belong to the checked pageId', () => {
  let crowi: Crowi;
  let app: express.Application;
  let testUser: IUserHasId;
  let otherUser: IUserHasId;

  let accessiblePageId: string;
  let accessibleRevisionId: string;
  let privatePageId: string;
  let privateRevisionId: string;

  function getRevision(
    revisionId: string,
    pageId: string,
    user: IUserHasId | undefined,
  ) {
    currentUser = user;
    return request(app).get(`${MOUNT_PATH}/${revisionId}`).query({ pageId });
  }

  let currentUser: IUserHasId | undefined;

  beforeAll(async () => {
    crowi = await getInstance();
    const { Page, User } = crowi.models;

    await Page.deleteMany({ path: { $in: [ACCESSIBLE_PATH, PRIVATE_PATH] } });

    testUser = await User.create({
      name: 'Revisions Integ User',
      username: `revisions-integ-user-${WORKER_ID}`,
      email: `revisions-integ-user-${WORKER_ID}@example.com`,
    });
    otherUser = await User.create({
      name: 'Revisions Integ Other User',
      username: `revisions-integ-other-${WORKER_ID}`,
      email: `revisions-integ-other-${WORKER_ID}@example.com`,
    });

    const accessiblePage = await Page.create({
      path: ACCESSIBLE_PATH,
      grant: PageGrant.GRANT_PUBLIC,
      creator: testUser._id,
      lastUpdateUser: testUser._id,
    });
    const privatePage = await Page.create({
      path: PRIVATE_PATH,
      grant: PageGrant.GRANT_OWNER,
      grantedUsers: [otherUser._id],
      creator: otherUser._id,
      lastUpdateUser: otherUser._id,
    });
    accessiblePageId = String(accessiblePage._id);
    privatePageId = String(privatePage._id);

    const accessibleRevision = await prisma.revisions.create({
      data: {
        pageId: accessiblePageId,
        body: 'ACCESSIBLE-PAGE-BODY',
        format: 'markdown',
        authorId: String(testUser._id),
      },
    });
    const privateRevision = await prisma.revisions.create({
      data: {
        pageId: privatePageId,
        body: 'PRIVATE-PAGE-BODY-MUST-NOT-LEAK',
        format: 'markdown',
        authorId: String(otherUser._id),
      },
    });
    accessibleRevisionId = accessibleRevision.id;
    privateRevisionId = privateRevision.id;

    const { setup } = await import('./revisions');
    const router = setup(crowi);

    app = express();
    app.use(express.json());
    app.use((req: AuthorizedRequest, res: Response & ApiV3Response, next) => {
      if (currentUser != null) {
        req.user = currentUser;
      }
      // biome-ignore lint/suspicious/noExplicitAny: test helper shim
      res.apiv3 = (data: any) => res.json({ ok: true, data });
      // biome-ignore lint/suspicious/noExplicitAny: test helper shim
      res.apiv3Err = (err: any, code = 400) =>
        res.status(code).json({ ok: false, error: String(err) });
      next();
    });
    app.use(MOUNT_PATH, router);
  }, 60_000);

  afterAll(async () => {
    await prisma.revisions.deleteMany({
      where: { pageId: { in: [accessiblePageId, privatePageId] } },
    });
    await crowi.models.Page.deleteMany({
      path: { $in: [ACCESSIBLE_PATH, PRIVATE_PATH] },
    });
    await crowi.models.User.deleteMany({
      _id: { $in: [testUser._id, otherUser._id] },
    });
  }, 30_000);

  it('rejects a revisionId that belongs to a different page than the checked pageId', async () => {
    // testUser can view accessiblePageId, but pairs it with a revisionId
    // that actually belongs to the private page — the crossover this bug
    // report described.
    const res = await getRevision(
      privateRevisionId,
      accessiblePageId,
      testUser,
    );

    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
    // Whatever the response is, it must not contain the private body.
    expect(JSON.stringify(res.body)).not.toContain(
      'PRIVATE-PAGE-BODY-MUST-NOT-LEAK',
    );
  });

  it('returns the revision when pageId and revisionId genuinely match and are accessible', async () => {
    const res = await getRevision(
      accessibleRevisionId,
      accessiblePageId,
      testUser,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.revision.body).toBe('ACCESSIBLE-PAGE-BODY');
  });

  it('rejects when the checked pageId itself is not accessible to the viewer, even with a matching revisionId', async () => {
    const res = await getRevision(privateRevisionId, privatePageId, testUser);

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(
      'PRIVATE-PAGE-BODY-MUST-NOT-LEAK',
    );
  });
});
