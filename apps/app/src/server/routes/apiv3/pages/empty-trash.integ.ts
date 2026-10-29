/**
 * Integration test — DELETE /empty-trash must delete exactly the trashed pages the
 * requester is allowed to delete completely, and leave the rest.
 *
 * The fixture and cleanup conventions follow delete-pages.integ.ts: the response
 * helpers are installed per request on this suite's own app, and everything written
 * lives under one path prefix.
 */

import {
  type IUserHasId,
  PageGrant,
  SubscriptionStatusType,
} from '@growi/core';
import { escapeStringForMongoRegex } from '@growi/core/dist/utils';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import mongoose, { type HydratedDocument, Types } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction } from '~/interfaces/activity';
import { PageDeleteConfigValue } from '~/interfaces/page-delete-config';
import type Crowi from '~/server/crowi';
import { InAppNotification } from '~/server/models/in-app-notification';
import Subscription from '~/server/models/subscription';
import { UserStatus } from '~/server/models/user/conts';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
import { LIMIT_FOR_MULTIPLE_PAGE_OP } from '~/server/service/page/consts';
import { prisma } from '~/utils/prisma';

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

vi.mock('~/server/middlewares/admin-required', () => ({
  default: () => passthroughMiddleware,
}));

const FIXTURE_ROOT = '/trash/empty-trash-route-integ';

const requesterUsername = 'empty-trash-route-integ-requester';
const subscriberUsername = 'empty-trash-route-integ-subscriber';

// Sentinel ip (reached via X-Forwarded-For) so cleanup removes only the activity rows
// this suite created. Keep it distinct from the sentinels sibling suites use.
const TEST_IP = '10.0.0.116';

const COMPLETE_DELETION_AUTHORITY_KEYS = [
  'security:pageCompleteDeletionAuthority',
  'security:pageRecursiveCompleteDeletionAuthority',
] as const;

const fixturePathPattern = new RegExp(
  `^${escapeStringForMongoRegex(FIXTURE_ROOT)}(/|$)`,
);

describe('DELETE /empty-trash', () => {
  let app: express.Application;
  let crowi: Crowi;
  let requester: HydratedDocument<IUserHasId>;
  let subscriber: HydratedDocument<IUserHasId>;

  const removeFixtures = async (): Promise<void> => {
    await crowi.models.Page.deleteMany({ path: fixturePathPattern });
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  };

  const createTrashedPages = (
    entries: { path: string; creator: Types.ObjectId | string }[],
  ) =>
    crowi.models.Page.create(
      entries.map(({ path, creator }) => ({
        path,
        grant: PageGrant.GRANT_PUBLIC,
        status: 'deleted',
        creator,
        lastUpdateUser: creator,
        parent: null,
      })),
    );

  const emptyTrash = () =>
    request(app).delete('/empty-trash').set('X-Forwarded-For', TEST_IP);

  const findSurvivingPaths = async (paths: string[]): Promise<string[]> => {
    const pages = await crowi.models.Page.find({ path: { $in: paths } });
    return pages.map((p) => p.path).sort();
  };

  beforeAll(async () => {
    crowi = await getInstance();
    const User = mongoose.model<IUserHasId>('User');

    await User.deleteMany({
      username: { $in: [requesterUsername, subscriberUsername] },
    });
    [requester, subscriber] = await User.create([
      {
        name: requesterUsername,
        username: requesterUsername,
        email: `${requesterUsername}@example.com`,
      },
      {
        name: subscriberUsername,
        username: subscriberUsername,
        email: `${subscriberUsername}@example.com`,
        // only active users are notified
        status: UserStatus.STATUS_ACTIVE,
      },
    ]);

    const responseHelpers: { response: Record<string, unknown> } = {
      response: {},
    };
    addCustomFunctionToResponse(responseHelpers);

    app = express();
    app.set('trust proxy', true);
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

  beforeEach(async () => {
    // The route acts on the whole trash, so pages earlier suites in this worker
    // left there would change which branch it takes.
    await crowi.models.Page.deleteMany({ path: /^\/trash\// });
    await removeFixtures();
  });

  afterEach(async () => {
    await removeFixtures();
    await crowi.configManager.updateConfigs(
      Object.fromEntries(
        COMPLETE_DELETION_AUTHORITY_KEYS.map((key) => [key, undefined]),
      ),
      { removeIfUndefined: true },
    );
  });

  afterAll(async () => {
    await crowi.models.User.deleteMany({
      username: { $in: [requesterUsername, subscriberUsername] },
    });
  });

  it('answers 200 when the trash is already empty', async () => {
    const response = await emptyTrash();

    expect(response.status).toBe(200);
  });

  it('deletes every trashed page under the default settings', async () => {
    const paths = [
      `${FIXTURE_ROOT}/own`,
      `${FIXTURE_ROOT}/others`,
      `${FIXTURE_ROOT}/others/child`,
    ];
    await createTrashedPages([
      { path: paths[0], creator: requester._id },
      { path: paths[1], creator: new Types.ObjectId() },
      { path: paths[2], creator: new Types.ObjectId() },
    ]);

    const response = await emptyTrash();

    expect(response.status).toBe(200);
    expect(await findSurvivingPaths(paths)).toEqual([]);
  });

  it('answers 403 and keeps the page when no trashed page may be deleted completely', async () => {
    const [trashedPage] = await createTrashedPages([
      { path: `${FIXTURE_ROOT}/target`, creator: requester._id },
    ]);
    // The requester authored the page but is not an admin, so AdminOnly
    // forbids the complete deletion.
    await crowi.configManager.updateConfig(
      'security:pageCompleteDeletionAuthority',
      PageDeleteConfigValue.AdminOnly,
    );

    const response = await emptyTrash();

    expect(response.status).toBe(403);
    expect(response.body.errors).toEqual([
      expect.objectContaining({
        code: 'complete_deletion_not_allowed_for_user',
      }),
    ]);
    expect(await findSurvivingPaths([trashedPage.path])).toEqual([
      trashedPage.path,
    ]);
  });

  describe('when the requester may delete only some of the trashed pages', () => {
    beforeEach(async () => {
      await crowi.configManager.updateConfig(
        'security:pageCompleteDeletionAuthority',
        PageDeleteConfigValue.AdminAndAuthor,
      );
    });

    it('deletes only the pages the requester may delete completely', async () => {
      const [ownPage, othersPage] = await createTrashedPages([
        { path: `${FIXTURE_ROOT}/own`, creator: requester._id },
        { path: `${FIXTURE_ROOT}/others`, creator: new Types.ObjectId() },
      ]);

      const response = await emptyTrash();

      expect(response.status).toBe(200);
      expect(await findSurvivingPaths([ownPage.path, othersPage.path])).toEqual(
        [othersPage.path],
      );
    });

    it(`deletes them all even when there are more than ${LIMIT_FOR_MULTIPLE_PAGE_OP}`, async () => {
      const ownPaths = Array.from(
        { length: LIMIT_FOR_MULTIPLE_PAGE_OP + 1 },
        (_, i) => `${FIXTURE_ROOT}/own-${i}`,
      );
      const othersPath = `${FIXTURE_ROOT}/others`;
      await createTrashedPages([
        ...ownPaths.map((path) => ({ path, creator: requester._id })),
        { path: othersPath, creator: new Types.ObjectId() },
      ]);

      const response = await emptyTrash();

      expect(response.status).toBe(200);
      expect(await findSurvivingPaths([...ownPaths, othersPath])).toEqual([
        othersPath,
      ]);
    });

    it('keeps a forbidden page that sits under a page the requester may delete', async () => {
      const parentPath = `${FIXTURE_ROOT}/own`;
      const childPath = `${parentPath}/others-child`;
      await createTrashedPages([
        { path: parentPath, creator: requester._id },
        { path: childPath, creator: new Types.ObjectId() },
      ]);

      const response = await emptyTrash();

      expect(response.status).toBe(200);
      expect(await findSurvivingPaths([parentPath, childPath])).toEqual([
        childPath,
      ]);
    });

    it('deletes pages whose paths contain regular expression metacharacters', async () => {
      const ownPaths = [
        `${FIXTURE_ROOT}/C++ notes`,
        `${FIXTURE_ROOT}/draft (wip`,
      ];
      const othersPath = `${FIXTURE_ROOT}/others`;
      await createTrashedPages([
        ...ownPaths.map((path) => ({ path, creator: requester._id })),
        { path: othersPath, creator: new Types.ObjectId() },
      ]);

      const response = await emptyTrash();

      expect(response.status).toBe(200);
      expect(await findSurvivingPaths([...ownPaths, othersPath])).toEqual([
        othersPath,
      ]);
    });

    it('records the complete deletion and notifies subscribers as a full empty does', async () => {
      const [ownPage] = await createTrashedPages([
        { path: `${FIXTURE_ROOT}/own`, creator: requester._id },
        { path: `${FIXTURE_ROOT}/others`, creator: new Types.ObjectId() },
      ]);
      await Subscription.subscribeByPageId(
        new Types.ObjectId(subscriber._id),
        ownPage._id,
        SubscriptionStatusType.SUBSCRIBE,
      );

      try {
        const response = await emptyTrash();

        expect(response.status).toBe(200);
        const recorded = await prisma.activities.findMany({
          where: {
            ip: TEST_IP,
            action: SupportedAction.ACTION_PAGE_RECURSIVELY_DELETE_COMPLETELY,
          },
        });
        expect(recorded).toHaveLength(1);
        expect(recorded[0].userId).toBe(requester._id.toString());
        // The notification is written after the response, so wait for it.
        await vi.waitFor(async () => {
          const notification = await InAppNotification.findOne({
            user: subscriber._id,
            action: SupportedAction.ACTION_PAGE_RECURSIVELY_DELETE_COMPLETELY,
          });
          expect(notification).not.toBeNull();
        });
      } finally {
        await Subscription.deleteMany({ user: subscriber._id });
        await InAppNotification.deleteMany({ user: subscriber._id });
      }
    });
  });

  it('judges each trashed page by the complete deletion authority for a single page', async () => {
    const [ownPage] = await createTrashedPages([
      { path: `${FIXTURE_ROOT}/own`, creator: requester._id },
    ]);
    await crowi.configManager.updateConfigs({
      'security:pageCompleteDeletionAuthority':
        PageDeleteConfigValue.AdminAndAuthor,
      'security:pageRecursiveCompleteDeletionAuthority':
        PageDeleteConfigValue.AdminOnly,
    });

    const response = await emptyTrash();

    expect(response.status).toBe(200);
    expect(await findSurvivingPaths([ownPage.path])).toEqual([]);
  });
});
