/**
 * Integration test — POST /pages/duplicate must answer 404 for both "no such
 * source page" and "the source page exists but the requester may not read it":
 * the two must be indistinguishable to the caller (see
 * apps/app/.claude/rules/page-write-action-403-404.md). The route used to
 * answer both with a single ambiguous 401, and separately crashed when
 * `security:disableUserPages` was enabled — it read `page.path` before
 * checking whether `page` was null.
 *
 * Only the not-found/forbidden branch (and the disableUserPages crash guard)
 * is exercised here — a full duplicate (source copy, descendant handling) is
 * covered by service/page/v5.public-page.integ.ts, not this route-level suite.
 */

import { type IUserHasId, PageGrant } from '@growi/core';
import { ConfigSource } from '@growi/core/dist/interfaces';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import mongoose, { type HydratedDocument, Types } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument } from '~/server/models/page';
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

vi.mock('~/server/middlewares/admin-required', () => ({
  default: () => passthroughMiddleware,
}));

const FIXTURE_ROOT = '/duplicate-route-integ';
const forbiddenPath = `${FIXTURE_ROOT}/forbidden`;

const requesterUsername = 'duplicate-route-integ-requester';
const ownerUsername = 'duplicate-route-integ-owner';

// Sentinel ip (reached via X-Forwarded-For) so cleanup removes only the activity
// rows this suite created — see the convention documented at the top of
// rename.integ.ts. Kept distinct from the sentinels sibling suites use.
const TEST_IP = '10.0.0.117';

describe('POST /duplicate', () => {
  let app: express.Application;
  let crowi: Crowi;
  let requester: HydratedDocument<IUserHasId>;
  let owner: HydratedDocument<IUserHasId>;
  let forbiddenPage: HydratedDocument<PageDocument>;
  let disableUserPagesBefore: boolean | undefined;

  beforeAll(async () => {
    crowi = await getInstance();
    const { Page } = crowi.models;
    const User = mongoose.model<IUserHasId>('User');

    disableUserPagesBefore = crowi.configManager.getConfig(
      'security:disableUserPages',
      ConfigSource.db,
    );

    await User.deleteMany({
      username: { $in: [requesterUsername, ownerUsername] },
    });

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

    forbiddenPage = await Page.create({
      path: forbiddenPath,
      grant: PageGrant.GRANT_OWNER,
      grantedUsers: [owner._id],
      creator: owner._id,
      lastUpdateUser: owner._id,
    });

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

  afterEach(async () => {
    await crowi.configManager.updateConfigs(
      { 'security:disableUserPages': disableUserPagesBefore },
      { removeIfUndefined: true },
    );
  });

  afterAll(async () => {
    const { Page } = crowi.models;
    await Page.deleteOne({ _id: forbiddenPage._id });
    await crowi.models.User.deleteMany({
      username: { $in: [requesterUsername, ownerUsername] },
    });
    await crowi.configManager.updateConfigs(
      { 'security:disableUserPages': disableUserPagesBefore },
      { removeIfUndefined: true },
    );
  });

  it('returns 404 when the source page does not exist', async () => {
    const pageId = new Types.ObjectId();

    const response = await request(app)
      .post('/duplicate')
      .set('X-Forwarded-For', TEST_IP)
      .send({
        pageId: pageId.toString(),
        pageNameInput: `${FIXTURE_ROOT}/from-missing`,
      });

    expect(response.status).toBe(404);
    expect(response.body.errors).toEqual([
      expect.objectContaining({
        code: 'notfound_or_forbidden',
        message: `Page '${pageId}' is not found or forbidden`,
      }),
    ]);
  });

  it('returns 404 (not 403) when the source page exists but the requester may not read it', async () => {
    const response = await request(app)
      .post('/duplicate')
      .set('X-Forwarded-For', TEST_IP)
      .send({
        pageId: forbiddenPage._id.toString(),
        pageNameInput: `${FIXTURE_ROOT}/from-forbidden`,
      });

    // Same status as the "source page does not exist" case above — a requester
    // without read access must not be able to tell a forbidden source page apart
    // from a missing one. See apps/app/.claude/rules/page-write-action-403-404.md.
    expect(response.status).toBe(404);
    expect(response.body.errors).toEqual([
      expect.objectContaining({
        code: 'notfound_or_forbidden',
        message: `Page '${forbiddenPage._id}' is not found or forbidden`,
      }),
    ]);
  });

  it('does not crash and still returns 404 when security:disableUserPages is enabled and the source page is not found', async () => {
    await crowi.configManager.updateConfig('security:disableUserPages', true);
    const pageId = new Types.ObjectId();

    const response = await request(app)
      .post('/duplicate')
      .set('X-Forwarded-For', TEST_IP)
      .send({
        pageId: pageId.toString(),
        pageNameInput: `${FIXTURE_ROOT}/from-missing-disable-user-pages`,
      });

    // Before the fix, `disableUserPages` handling read `page.path` before the
    // null check, throwing instead of answering cleanly.
    expect(response.status).toBe(404);
    expect(response.body.errors).toEqual([
      expect.objectContaining({ code: 'notfound_or_forbidden' }),
    ]);
  });
});
