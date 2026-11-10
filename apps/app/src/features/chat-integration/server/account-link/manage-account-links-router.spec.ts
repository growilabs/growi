// Proves task 6.2's routing-level contract: the "my chat account links"
// screen's API requires a real, logged-in GROWI session, lists only the
// caller's own links, and refuses to delete another user's link even given
// its exact id.
//
// Uses the REAL `loginRequiredFactory` (not mocked away), same convention as
// `account-link-router.spec.ts`.

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
import { createManageAccountLinksRouter } from './manage-account-links-router';
import { ChatAccountLink } from './models/chat-account-link';

const RELATION_ID = 'relation-under-test';
const MOUNT_PATH = '/_api/v3/chat-integration/my-account-links';

const buildUser = (username: string): IUserHasId =>
  ({
    _id: new Types.ObjectId().toString(),
    username,
    status: 2, // UserStatus.STATUS_ACTIVE -- loginRequiredFactory gates on this
  }) as IUserHasId;

const buildMockCrowi = (): Crowi => mock<Crowi>();

const buildApp = (injectUser?: IUserHasId): Express => {
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
  app.use(MOUNT_PATH, createManageAccountLinksRouter(buildMockCrowi()));
  return app;
};

const seedRelation = () =>
  ChatRelation.create({
    relationId: RELATION_ID,
    proxyUri: 'https://proxy.example.test',
    platform: 'slack',
    workspaceId: 'workspace-0001',
    workspaceName: 'Test Workspace',
    label: null,
    state: 'active',
    settingsVersion: 0,
    createdAt: new Date(),
  });

describe('manage-account-links-router', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_manage_account_links_router',
    ));
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  beforeEach(async () => {
    await ChatAccountLink.deleteMany({});
    await ChatRelation.deleteMany({});
  });

  describe('login requirement', () => {
    it('refuses GET / without a logged-in session', async () => {
      const app = buildApp();

      const response = await request(app).get(MOUNT_PATH);

      expect(response.status).not.toBe(200);
    });

    it('refuses DELETE /:id without a logged-in session', async () => {
      await seedRelation();
      const me = buildUser('me');
      const link = await ChatAccountLink.create({
        relationId: RELATION_ID,
        userId: me._id,
        platform: 'slack',
        accountId: 'U-alice',
        linkedAt: new Date(),
      });
      const app = buildApp();

      const response = await request(app).delete(
        `${MOUNT_PATH}/${link._id.toString()}`,
      );

      expect(response.status).not.toBe(200);
      expect(await ChatAccountLink.findById(link._id)).not.toBeNull();
    });
  });

  describe('GET /', () => {
    it("returns only the logged-in user's own links, not another user's", async () => {
      await seedRelation();
      const me = buildUser('me');
      const someoneElse = buildUser('someone-else');
      await ChatAccountLink.create({
        relationId: RELATION_ID,
        userId: me._id,
        platform: 'slack',
        accountId: 'U-mine',
        linkedAt: new Date(),
      });
      await ChatAccountLink.create({
        relationId: RELATION_ID,
        userId: someoneElse._id,
        platform: 'slack',
        accountId: 'U-not-mine',
        linkedAt: new Date(),
      });
      const app = buildApp(me);

      const response = await request(app).get(MOUNT_PATH);

      expect(response.status).toBe(200);
      expect(response.body.links).toHaveLength(1);
      expect(response.body.links[0].accountId).toBe('U-mine');
    });
  });

  describe('DELETE /:id', () => {
    it("unlinks the caller's own link and answers 200", async () => {
      await seedRelation();
      const me = buildUser('me');
      const link = await ChatAccountLink.create({
        relationId: RELATION_ID,
        userId: me._id,
        platform: 'slack',
        accountId: 'U-alice',
        linkedAt: new Date(),
      });
      const app = buildApp(me);

      const response = await request(app).delete(
        `${MOUNT_PATH}/${link._id.toString()}`,
      );

      expect(response.status).toBe(200);
      expect(await ChatAccountLink.findById(link._id)).toBeNull();
    });

    it("answers 404 and does NOT delete when the id belongs to another user's link", async () => {
      await seedRelation();
      const me = buildUser('me');
      const someoneElse = buildUser('someone-else');
      const othersLink = await ChatAccountLink.create({
        relationId: RELATION_ID,
        userId: someoneElse._id,
        platform: 'slack',
        accountId: 'U-not-mine',
        linkedAt: new Date(),
      });
      const app = buildApp(me);

      const response = await request(app).delete(
        `${MOUNT_PATH}/${othersLink._id.toString()}`,
      );

      expect(response.status).toBe(404);
      expect(await ChatAccountLink.findById(othersLink._id)).not.toBeNull();
    });

    it('answers 404 for an id that does not exist', async () => {
      const me = buildUser('me');
      const app = buildApp(me);

      const response = await request(app).delete(
        `${MOUNT_PATH}/${new Types.ObjectId().toString()}`,
      );

      expect(response.status).toBe(404);
    });
  });
});
