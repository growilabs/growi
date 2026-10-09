// Proves task 6.1's routing-level contract: the approval screen's API
// requires a real, logged-in GROWI session (Requirement 7.3's "ログインした
// 状態で"), and its two endpoints answer the outcomes
// `account-link-service.ts` can produce with the right HTTP status.
//
// Uses the REAL `loginRequiredFactory` (not mocked away) for the
// "unauthenticated is refused" case -- that is the actual behavior under
// test here, not incidental plumbing.

import type { IUserHasId } from '@growi/core/dist/interfaces';
import type { Express, NextFunction, Request, Response } from 'express';
import express from 'express';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mock } from 'vitest-mock-extended';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import type Crowi from '~/server/crowi';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';

import { ChatRelation } from '../models/chat-relation';
import { createAccountLinkRouter } from './account-link-router';
import { ChatAccountLink } from './models/chat-account-link';
import { ChatAccountLinkOrder } from './models/chat-account-link-order';

const RELATION_ID = 'relation-under-test';
const MOUNT_PATH = '/_api/v3/chat-integration/account-link';

const approvingUser: IUserHasId = {
  _id: new Types.ObjectId().toString(),
  username: 'approving-user',
  status: 2, // UserStatus.STATUS_ACTIVE -- loginRequiredFactory gates on this
} as IUserHasId;

/** A Crowi whose `aclService.isGuestAllowedToRead()` is never actually
 * consulted (loginRequiredFactory's default `isGuestAllowed = false` short-
 * circuits before reaching it) -- an auto-stub is enough. */
const buildMockCrowi = (): Crowi => mock<Crowi>();

/** Real router, real `loginRequiredFactory`. `injectUser` mimics what
 * passport would have already set on `req.user` by the time this router's
 * middleware chain runs -- omit it to exercise the unauthenticated path. */
const buildApp = (injectUser?: IUserHasId): Express => {
  // Install `res.apiv3`/`res.apiv3Err` on THIS suite's responses only, not
  // on the shared `express` module -- see `pages/rename.integ.ts`'s file
  // header for why mutating the shared module would leak across every app
  // built later in the same worker.
  const responseHelpers: { response: Record<string, unknown> } = {
    response: {},
  };
  addCustomFunctionToResponse(responseHelpers);

  const app = express();
  app.use(express.json());
  app.use((_req: Request, res: Response, next: NextFunction) => {
    Object.assign(res, responseHelpers.response);
    next();
  });
  if (injectUser != null) {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { user: IUserHasId }).user = injectUser;
      next();
    });
  }
  app.use(MOUNT_PATH, createAccountLinkRouter(buildMockCrowi()));
  return app;
};

const seedRelation = () =>
  ChatRelation.create({
    relationId: RELATION_ID,
    proxyUri: 'https://proxy.example.test',
    platform: 'slack',
    workspaceId: 'workspace-0001',
    workspaceName: 'Test Workspace',
    label: 'Our Slack',
    state: 'active',
    settingsVersion: 0,
    createdAt: new Date(),
  });

const seedLiveOrder = (token: string) =>
  ChatAccountLinkOrder.create({
    token,
    relationId: RELATION_ID,
    platform: 'slack',
    accountId: 'U-alice',
    isRevoked: false,
    createdAt: new Date(),
    expiredAt: new Date(Date.now() + 10 * 60_000),
  });

describe('account-link-router', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_account_link_router',
    ));
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  beforeEach(async () => {
    await ChatAccountLinkOrder.deleteMany({});
    await ChatAccountLink.deleteMany({});
    await ChatRelation.deleteMany({});
  });

  describe('login requirement', () => {
    it('refuses GET without a logged-in session', async () => {
      await seedRelation();
      await seedLiveOrder('live-token');
      const app = buildApp();

      const response = await request(app).get(`${MOUNT_PATH}/live-token`);

      expect(response.status).not.toBe(200);
    });

    it('refuses POST approve without a logged-in session', async () => {
      await seedRelation();
      await seedLiveOrder('live-token');
      const app = buildApp();

      const response = await request(app).post(
        `${MOUNT_PATH}/live-token/approve`,
      );

      expect(response.status).not.toBe(200);
      expect(
        await ChatAccountLink.countDocuments({ relationId: RELATION_ID }),
      ).toBe(0);
    });
  });

  describe('GET /:token', () => {
    it('returns 404 for a token that does not resolve to a live order', async () => {
      const app = buildApp(approvingUser);

      const response = await request(app).get(`${MOUNT_PATH}/no-such-token`);

      expect(response.status).toBe(404);
    });

    it('returns the display data for a live order when logged in', async () => {
      await seedRelation();
      await seedLiveOrder('live-token');
      const app = buildApp(approvingUser);

      const response = await request(app).get(`${MOUNT_PATH}/live-token`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        platform: 'slack',
        accountId: 'U-alice',
        workspaceName: 'Test Workspace',
        growiUsername: approvingUser.username,
      });
    });
  });

  describe('POST /:token/approve', () => {
    it('links on a valid, live token and answers 200', async () => {
      await seedRelation();
      await seedLiveOrder('live-token');
      const app = buildApp(approvingUser);

      const response = await request(app).post(
        `${MOUNT_PATH}/live-token/approve`,
      );

      expect(response.status).toBe(200);
      expect(
        await ChatAccountLink.countDocuments({
          relationId: RELATION_ID,
          platform: 'slack',
          accountId: 'U-alice',
        }),
      ).toBe(1);
    });

    it('answers 404 on a second approval of the same token (already used)', async () => {
      await seedRelation();
      await seedLiveOrder('live-token');
      const app = buildApp(approvingUser);

      await request(app).post(`${MOUNT_PATH}/live-token/approve`);
      const second = await request(app).post(
        `${MOUNT_PATH}/live-token/approve`,
      );

      expect(second.status).toBe(404);
    });

    it("answers 409 'taken-by-another-user' when the chat account is already linked to someone else", async () => {
      await seedRelation();
      await seedLiveOrder('live-token');
      await ChatAccountLink.create({
        relationId: RELATION_ID,
        userId: new Types.ObjectId(),
        platform: 'slack',
        accountId: 'U-alice',
        linkedAt: new Date(),
      });
      const app = buildApp(approvingUser);

      const response = await request(app).post(
        `${MOUNT_PATH}/live-token/approve`,
      );

      expect(response.status).toBe(409);
      expect(response.body.errors[0].code).toBe('taken-by-another-user');
    });
  });
});
