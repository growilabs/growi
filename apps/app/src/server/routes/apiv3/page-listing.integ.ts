import type { IUserHasId } from '@growi/core';
import { PageGrant } from '@growi/core';
import type { Request } from 'express';
import express from 'express';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import type { ApiV3Response } from './interfaces/apiv3-response';
import addCustomFunctionToResponse from './response';

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const PUBLIC_PAGE_PATH = `/page-listing-integ-public-${WORKER_ID}`;
const USERNAME = `page-listing-integ-user-${WORKER_ID}`;
const PUBLIC_PAGE_BODY = 'PAGE-LISTING-INTEG-PUBLIC-BODY';
// loginRequired answers 403 (instead of redirecting) only under /_api/
const MOUNT_PATH = '/_api/v3/page-listing';

interface AuthorizedRequest extends Request {
  user?: IUserHasId;
}

describe('GET /page-listing/info', () => {
  let crowi: Crowi;
  let app: express.Application;
  let loggedInUser: IUserHasId;
  let currentUser: IUserHasId | undefined;
  let publicPageId: string;

  const getInfo = (user: IUserHasId | undefined) => {
    currentUser = user;
    return request(app)
      .get(`${MOUNT_PATH}/info`)
      .query({ 'pageIds[]': publicPageId, attachShortBody: true });
  };

  const setGuestMode = async (mode: 'Deny' | 'Readonly'): Promise<void> => {
    await configManager.updateConfig('security:restrictGuestMode', mode, {
      skipPubsub: true,
    });
  };

  beforeAll(async () => {
    crowi = await getInstance();
    const { Page, User } = crowi.models;

    await Page.deleteMany({ path: PUBLIC_PAGE_PATH });
    await User.deleteMany({ username: USERNAME });

    loggedInUser = await User.create({
      name: 'Page Listing Integ User',
      username: USERNAME,
      email: `${USERNAME}@example.com`,
    });

    const publicPage = await Page.create({
      path: PUBLIC_PAGE_PATH,
      grant: PageGrant.GRANT_PUBLIC,
      creator: loggedInUser._id,
      lastUpdateUser: loggedInUser._id,
    });
    publicPageId = String(publicPage._id);

    const revision = await prisma.revisions.create({
      data: {
        pageId: publicPageId,
        body: PUBLIC_PAGE_BODY,
        format: 'markdown',
        authorId: String(loggedInUser._id),
      },
    });
    await Page.updateOne({ _id: publicPage._id }, { revision: revision.id });

    const responseHelpers: { response: Record<string, unknown> } = {
      response: {},
    };
    addCustomFunctionToResponse(responseHelpers);

    const { default: routerFactory } = await import('./page-listing');

    app = express();
    app.use(express.json());
    app.use((req: AuthorizedRequest, res: ApiV3Response, next) => {
      if (currentUser != null) {
        req.user = currentUser;
      }
      Object.assign(res, responseHelpers.response);
      next();
    });
    app.use(MOUNT_PATH, routerFactory(crowi));
  }, 60_000);

  // beforeAll may have failed midway, so only clean up what was created.
  afterAll(async () => {
    await configManager.removeConfigs(['security:restrictGuestMode'], {
      skipPubsub: true,
    });
    const { Page, User } = crowi.models;
    if (publicPageId != null) {
      await prisma.revisions.deleteMany({ where: { pageId: publicPageId } });
    }
    await Page.deleteMany({ path: PUBLIC_PAGE_PATH });
    await User.deleteMany({ username: USERNAME });
  });

  describe('when guest access is denied', () => {
    beforeAll(async () => {
      await setGuestMode('Deny');
    });

    it('refuses a request without a user and returns no page data', async () => {
      const response = await getInfo(undefined);

      expect(response.status).toBe(403);
      expect(JSON.stringify(response.body)).not.toContain(publicPageId);
      expect(response.text).not.toContain(PUBLIC_PAGE_BODY);
    });

    it('returns the info to a logged-in user', async () => {
      const response = await getInfo(loggedInUser);

      expect(response.status).toBe(200);
      expect(response.body[publicPageId]).toMatchObject({
        isEmpty: false,
        revisionShortBody: PUBLIC_PAGE_BODY,
      });
    });
  });

  describe('when guest access is allowed (Readonly)', () => {
    beforeAll(async () => {
      await setGuestMode('Readonly');
    });

    it('returns the info of a public page, with its short body, to a request without a user', async () => {
      const response = await getInfo(undefined);

      expect(response.status).toBe(200);
      expect(response.body[publicPageId]).toMatchObject({
        isEmpty: false,
        revisionShortBody: PUBLIC_PAGE_BODY,
      });
    });

    it('returns the info to a logged-in user', async () => {
      const response = await getInfo(loggedInUser);

      expect(response.status).toBe(200);
      expect(response.body[publicPageId]).toMatchObject({
        isEmpty: false,
        revisionShortBody: PUBLIC_PAGE_BODY,
      });
    });
  });
});
