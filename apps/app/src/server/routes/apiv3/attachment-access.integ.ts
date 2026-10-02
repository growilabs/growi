/**
 * Regression test for GET /attachment/:id — the handler must check the
 * viewer's access to the attachment's owning page, mirroring the check
 * /attachment/list already performs.
 *
 * Real MongoDB (Page/User/Attachment) + the real route handler exported
 * from ./attachment. Only accessTokenParser / login-required are stubbed to
 * a passthrough (auth is not what this test verifies); the real
 * Page.isAccessiblePageByViewer and the real handler logic run unmodified,
 * mirroring the attachment-add-activity.integ.ts precedent.
 */

import type { IUserHasId } from '@growi/core';
import { PageGrant } from '@growi/core';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { AttachmentType } from '~/server/interfaces/attachment';
import { Attachment } from '~/server/models/attachment';

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
const ACCESSIBLE_PATH = `/attachment-access-integ-accessible-${WORKER_ID}`;
const PRIVATE_PATH = `/attachment-access-integ-private-${WORKER_ID}`;
const MOUNT_PATH = '/attachment';

interface AuthorizedRequest extends Request {
  user?: IUserHasId;
}

describe("GET /attachment/:id — must check access to the attachment's owning page", () => {
  let crowi: Crowi;
  let app: express.Application;
  let testUser: IUserHasId;
  let otherUser: IUserHasId;

  let accessiblePageId: string;
  let privatePageId: string;
  let privateAttachmentId: string;
  let accessibleAttachmentId: string;
  let profileImageAttachmentId: string;

  let currentUser: IUserHasId | undefined;

  function getAttachment(attachmentId: string, user: IUserHasId | undefined) {
    currentUser = user;
    return request(app).get(`${MOUNT_PATH}/${attachmentId}`);
  }

  beforeAll(async () => {
    crowi = await getInstance();
    const { Page, User } = crowi.models;

    await Page.deleteMany({ path: { $in: [ACCESSIBLE_PATH, PRIVATE_PATH] } });

    testUser = await User.create({
      name: 'Attachment Access Integ User',
      username: `attachment-access-integ-user-${WORKER_ID}`,
      email: `attachment-access-integ-user-${WORKER_ID}@example.com`,
    });
    otherUser = await User.create({
      name: 'Attachment Access Integ Other User',
      username: `attachment-access-integ-other-${WORKER_ID}`,
      email: `attachment-access-integ-other-${WORKER_ID}@example.com`,
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

    const accessibleAttachment = await Attachment.create({
      page: accessiblePageId,
      creator: testUser._id,
      fileName: `attachment-access-integ-accessible-${WORKER_ID}`,
      fileFormat: 'text/plain',
      originalName: 'accessible.txt',
      attachmentType: AttachmentType.WIKI_PAGE,
    });
    const privateAttachment = await Attachment.create({
      page: privatePageId,
      creator: otherUser._id,
      fileName: `attachment-access-integ-private-${WORKER_ID}`,
      fileFormat: 'text/plain',
      originalName: 'SECRET-ORIGINAL-NAME.txt',
      attachmentType: AttachmentType.WIKI_PAGE,
    });
    accessibleAttachmentId = String(accessibleAttachment._id);
    privateAttachmentId = String(privateAttachment._id);

    const profileImageAttachment = await Attachment.create({
      creator: otherUser._id,
      fileName: `attachment-access-integ-profile-image-${WORKER_ID}`,
      fileFormat: 'image/png',
      originalName: 'avatar.png',
      attachmentType: AttachmentType.PROFILE_IMAGE,
    });
    profileImageAttachmentId = String(profileImageAttachment._id);

    const { setup } = await import('./attachment');
    const router = setup(crowi);

    app = express();
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
    await Attachment.deleteMany({
      _id: {
        $in: [
          accessibleAttachmentId,
          privateAttachmentId,
          profileImageAttachmentId,
        ],
      },
    });
    await crowi.models.Page.deleteMany({
      path: { $in: [ACCESSIBLE_PATH, PRIVATE_PATH] },
    });
    await crowi.models.User.deleteMany({
      _id: { $in: [testUser._id, otherUser._id] },
    });
  }, 30_000);

  it("rejects a viewer who cannot access the attachment's owning page", async () => {
    const res = await getAttachment(privateAttachmentId, testUser);

    expect(res.status).toBe(404);
    // Metadata (original filename, etc.) must not leak alongside the rejection.
    expect(JSON.stringify(res.body)).not.toContain('SECRET-ORIGINAL-NAME.txt');
  });

  it('returns the attachment metadata when the viewer can access the owning page', async () => {
    const res = await getAttachment(accessibleAttachmentId, testUser);

    expect(res.status).toBe(200);
    expect(res.body.data.attachment.originalName).toBe('accessible.txt');
  });

  it('returns metadata for a non-page-scoped attachment (e.g. PROFILE_IMAGE), which has no page to check', async () => {
    const res = await getAttachment(profileImageAttachmentId, testUser);

    expect(res.status).toBe(200);
    expect(res.body.data.attachment.originalName).toBe('avatar.png');
  });
});
