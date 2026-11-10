// Proves task 9.0's own literal completion condition: an empty or
// verification-failing callback to `POST /verify` is refused with 400.
// Also proves `POST /state` requires a real, logged-in GROWI ADMIN session
// (not just any logged-in user) -- see `oauth-install-router.ts`'s header
// for why `/verify` is deliberately NOT session-gated.

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

import { ChatOAuthInstallState } from './models/chat-oauth-install-state';
import { createOAuthInstallRouter } from './oauth-install-router';

const MOUNT_PATH = '/_api/v3/chat-integration/oauth-install';

const adminUser: IUserHasId = {
  _id: new Types.ObjectId().toString(),
  username: 'admin-user',
  status: 2, // UserStatus.STATUS_ACTIVE -- loginRequiredFactory gates on this
  admin: true,
} as IUserHasId;

const nonAdminUser: IUserHasId = {
  _id: new Types.ObjectId().toString(),
  username: 'plain-user',
  status: 2,
  admin: false,
} as IUserHasId;

/** A Crowi whose services are never actually consulted by this router. */
const buildMockCrowi = (): Crowi => mock<Crowi>();

/** Real router, real `loginRequiredFactory` + `adminRequiredFactory`.
 * `injectUser` mimics what passport would have already set on `req.user`
 * by the time this router's middleware chain runs -- omit it to exercise
 * the unauthenticated path. */
const buildApp = (injectUser?: IUserHasId): Express => {
  // Install `res.apiv3`/`res.apiv3Err` on THIS suite's responses only --
  // see `account-link-router.spec.ts` for why mutating the shared `express`
  // module would leak across every app built later in the same worker.
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
  app.use(MOUNT_PATH, createOAuthInstallRouter(buildMockCrowi()));
  return app;
};

describe('oauth-install-router', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_oauth_install_router',
    ));
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  beforeEach(async () => {
    await ChatOAuthInstallState.deleteMany({});
  });

  describe('POST /state', () => {
    it('refuses without a logged-in session', async () => {
      const app = buildApp();

      const response = await request(app)
        .post(`${MOUNT_PATH}/state`)
        .send({ platform: 'slack' });

      expect(response.status).not.toBe(200);
      expect(await ChatOAuthInstallState.countDocuments({})).toBe(0);
    });

    it('refuses a logged-in NON-admin user', async () => {
      const app = buildApp(nonAdminUser);

      const response = await request(app)
        .post(`${MOUNT_PATH}/state`)
        .send({ platform: 'slack' });

      expect(response.status).not.toBe(200);
      expect(await ChatOAuthInstallState.countDocuments({})).toBe(0);
    });

    it('answers 400 for an unsupported platform', async () => {
      const app = buildApp(adminUser);

      const response = await request(app)
        .post(`${MOUNT_PATH}/state`)
        .send({ platform: 'not-a-real-platform' });

      expect(response.status).toBe(400);
      expect(await ChatOAuthInstallState.countDocuments({})).toBe(0);
    });

    it('issues a state for an admin, tied to the requested platform', async () => {
      const app = buildApp(adminUser);

      const response = await request(app)
        .post(`${MOUNT_PATH}/state`)
        .send({ platform: 'slack' });

      expect(response.status).toBe(200);
      expect(response.body.state).toBeTypeOf('string');
      expect(response.body.state.length).toBeGreaterThanOrEqual(64);
      expect(
        await ChatOAuthInstallState.countDocuments({
          state: response.body.state,
          platform: 'slack',
        }),
      ).toBe(1);
    });
  });

  describe('POST /verify', () => {
    it('answers 400 for an empty state, with no logged-in session required', async () => {
      const app = buildApp();

      const response = await request(app)
        .post(`${MOUNT_PATH}/verify`)
        .send({ state: '' });

      expect(response.status).toBe(400);
    });

    it('answers 400 for a state that was never issued', async () => {
      const app = buildApp();

      const response = await request(app)
        .post(`${MOUNT_PATH}/verify`)
        .send({ state: 'forged-value' });

      expect(response.status).toBe(400);
    });

    it('answers 400 for an expired state', async () => {
      const issuingApp = buildApp(adminUser);
      const issued = await request(issuingApp)
        .post(`${MOUNT_PATH}/state`)
        .send({ platform: 'slack' });
      await ChatOAuthInstallState.updateOne(
        { state: issued.body.state },
        { expiresAt: new Date(Date.now() - 1000) },
      );
      const app = buildApp();

      const response = await request(app)
        .post(`${MOUNT_PATH}/verify`)
        .send({ state: issued.body.state });

      expect(response.status).toBe(400);
    });

    it('answers 200 for a valid, unexpired, previously-issued state', async () => {
      const issuingApp = buildApp(adminUser);
      const issued = await request(issuingApp)
        .post(`${MOUNT_PATH}/state`)
        .send({ platform: 'slack' });
      const app = buildApp();

      const response = await request(app)
        .post(`${MOUNT_PATH}/verify`)
        .send({ state: issued.body.state });

      expect(response.status).toBe(200);
      expect(response.body.platform).toBe('slack');
    });

    it('answers 400 on a second verification of the same state (one-time use)', async () => {
      const issuingApp = buildApp(adminUser);
      const issued = await request(issuingApp)
        .post(`${MOUNT_PATH}/state`)
        .send({ platform: 'slack' });
      const app = buildApp();

      await request(app)
        .post(`${MOUNT_PATH}/verify`)
        .send({ state: issued.body.state });
      const second = await request(app)
        .post(`${MOUNT_PATH}/verify`)
        .send({ state: issued.body.state });

      expect(second.status).toBe(400);
    });
  });
});
