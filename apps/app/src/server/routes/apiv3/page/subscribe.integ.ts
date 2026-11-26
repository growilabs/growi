import {
  type IUserHasId,
  PageGrant,
  SubscriptionStatusType,
} from '@growi/core';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import mongoose, { type HydratedDocument, Types } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument } from '~/server/models/page';
import Subscription from '~/server/models/subscription';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';

type AuthenticatedRequest = Request & {
  user?: HydratedDocument<IUserHasId>;
};

const passthroughMiddleware = (
  _req: Request,
  _res: Response,
  next: NextFunction,
) => next();

vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser: () => passthroughMiddleware,
}));

vi.mock('~/server/middlewares/login-required', () => ({
  default: () => passthroughMiddleware,
}));

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const PREFIX = `/page-subscribe-route-integ-${WORKER_ID}`;
const requesterUsername = `page-subscribe-requester-${WORKER_ID}`;
const ownerUsername = `page-subscribe-owner-${WORKER_ID}`;

describe('PUT /page/subscribe', () => {
  let app: express.Application;
  let crowi: Crowi;
  let requester: HydratedDocument<IUserHasId>;
  let owner: HydratedDocument<IUserHasId>;
  let publicPage: HydratedDocument<PageDocument>;
  let ownerOnlyPage: HydratedDocument<PageDocument>;
  let emptyPage: HydratedDocument<PageDocument>;

  const subscriptionStatusOf = async (
    pageId: Types.ObjectId,
  ): Promise<string | undefined> => {
    const subscription = await Subscription.findByUserIdAndTargetId(
      requester._id,
      pageId,
    );
    return subscription?.status;
  };

  beforeAll(async () => {
    crowi = await getInstance();
    const { Page } = crowi.models;
    const User = mongoose.model<IUserHasId>('User');

    requester = await User.create({
      name: requesterUsername,
      username: requesterUsername,
      email: `${requesterUsername}@example.com`,
    });
    owner = await User.create({
      name: ownerUsername,
      username: ownerUsername,
      email: `${ownerUsername}@example.com`,
    });

    publicPage = await Page.create({
      path: `${PREFIX}/public`,
      grant: PageGrant.GRANT_PUBLIC,
      creator: owner._id,
      lastUpdateUser: owner._id,
    });
    ownerOnlyPage = await Page.create({
      path: `${PREFIX}/owner-only`,
      grant: PageGrant.GRANT_OWNER,
      grantedUsers: [owner._id],
      creator: owner._id,
      lastUpdateUser: owner._id,
    });

    emptyPage = await Page.create({
      path: `${PREFIX}/empty`,
      grant: PageGrant.GRANT_PUBLIC,
      isEmpty: true,
    });

    const responseHelpers: { response: Record<string, unknown> } = {
      response: {},
    };
    addCustomFunctionToResponse(responseHelpers);

    app = express();
    app.use(express.json());
    app.use((_req, res, next) => {
      Object.assign(res, responseHelpers.response);
      next();
    });
    app.use((req: AuthenticatedRequest, _res, next) => {
      req.user = requester;
      next();
    });

    const { setup } = await import('./index');
    app.use('/', setup(crowi));
  }, 120_000);

  afterEach(async () => {
    await Subscription.deleteMany({ user: requester._id });
  });

  afterAll(async () => {
    const { Page } = crowi.models;
    await Page.deleteMany({ path: new RegExp(`^${PREFIX}/`) });
    await crowi.models.User.deleteMany({
      _id: { $in: [requester._id, owner._id] },
    });
  });

  it.each([
    ['a page the requester can view', () => publicPage._id],
    ['an empty page the requester can view', () => emptyPage._id],
  ])('subscribes to %s', async (_label, getPageId) => {
    const pageId = getPageId();

    const response = await request(app).put('/subscribe').send({
      pageId: pageId.toString(),
      status: SubscriptionStatusType.SUBSCRIBE,
    });

    expect(response.status).toBe(200);
    expect(await subscriptionStatusOf(pageId)).toBe(
      SubscriptionStatusType.SUBSCRIBE,
    );
  });

  it.each([
    ['a page the requester cannot view', () => ownerOnlyPage._id],
    ['a page that does not exist', () => new Types.ObjectId()],
  ])('answers the same 404 and stores nothing for %s', async (_label, getPageId) => {
    const pageId = getPageId();

    const response = await request(app).put('/subscribe').send({
      pageId: pageId.toString(),
      status: SubscriptionStatusType.SUBSCRIBE,
    });

    expect(response.status).toBe(404);
    expect(response.body.errors).toEqual([
      expect.objectContaining({
        code: 'notfound_or_forbidden',
        message: `Page '${pageId}' is not found or forbidden`,
      }),
    ]);
    expect(await subscriptionStatusOf(pageId)).toBeUndefined();
  });

  it('lets a subscriber who lost access unsubscribe', async () => {
    await Subscription.subscribeByPageId(
      new Types.ObjectId(requester._id),
      ownerOnlyPage._id,
      SubscriptionStatusType.SUBSCRIBE,
    );

    const response = await request(app).put('/subscribe').send({
      pageId: ownerOnlyPage._id.toString(),
      status: SubscriptionStatusType.UNSUBSCRIBE,
    });

    expect(response.status).toBe(200);
    expect(await subscriptionStatusOf(ownerOnlyPage._id)).toBe(
      SubscriptionStatusType.UNSUBSCRIBE,
    );
  });
});
