/**
 * Routing / real-auth-chain integration tests for the inline-comment feature
 * (task 3.5's observable completion condition: "no login" and "no page
 * permission" are both rejected).
 *
 * Unlike the other `*.integ.ts` files in this directory, `accessTokenParser`
 * and `loginRequired` are NOT mocked here — this file exercises the real
 * production middleware chain, mounted at the real production path
 * (`/_api/v3/inline-comments`), to prove what actually happens when nobody is
 * logged in.
 *
 * Verified real behavior (not the task text's literal "401"): GROWI's
 * `loginRequiredFactory` branches on `req.baseUrl` — when it matches
 * `/^\/_api\/.+$/` (true for every apiv3 route, mounted here exactly as
 * production mounts it) an unauthenticated caller gets `res.sendStatus(403)`,
 * not a 401 and not a redirect. This is not specific to this feature: see
 * `apps/app/src/server/routes/apiv3/g2g-transfer-preflight.integ.ts`
 * ("refuses a caller who never logged in with 403") and
 * `apps/app/src/server/middlewares/login-required.ts`. No apiv3 route in this
 * codebase manually returns 401 for a missing/absent login — `accessTokenParser`
 * itself never rejects (an absent/invalid token is a silent no-op, falling
 * through to `loginRequired`). So "no login -> 401" from the task text does
 * not hold for this codebase's actual middleware; "no login -> 403" does, and
 * that is what this suite asserts.
 *
 * The "no page permission" case (authenticated, but lacking view permission
 * on the target page) is covered per-route in create.integ.ts /
 * create-reply.integ.ts / list.integ.ts / resolve.integ.ts, each asserting a
 * uniform 404 per apps/app/.claude/rules/page-write-action-403-404.md.
 *
 * Requirements: 1.5, 1.6, 6.1
 */

import express from 'express';
import { Types } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';

import { createInlineCommentRouteHandlersFactory } from './create';
import { createInlineCommentReplyRouteHandlersFactory } from './create-reply';
import { listInlineCommentsRouteHandlersFactory } from './list';
import { resolveInlineCommentRouteHandlersFactory } from './resolve';

/** Where production mounts this router (apps/app/src/server/routes/apiv3/index.js). */
const MOUNT_PREFIX = '/_api/v3/inline-comments';

describe('inline-comment routes — real auth chain, no login', () => {
  let app: express.Application;
  let crowi: Crowi;

  beforeAll(async () => {
    crowi = await getInstance();
    crowi.setupCommentService();

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

    // No req.user injector here — every request in this suite is anonymous.
    const inlineCommentsRouter = express.Router();
    inlineCommentsRouter.post(
      '/',
      createInlineCommentRouteHandlersFactory(crowi),
    );
    inlineCommentsRouter.post(
      '/:id/replies',
      createInlineCommentReplyRouteHandlersFactory(crowi),
    );
    inlineCommentsRouter.get(
      '/',
      listInlineCommentsRouteHandlersFactory(crowi),
    );
    inlineCommentsRouter.put(
      '/:id/resolve',
      resolveInlineCommentRouteHandlersFactory(crowi),
    );
    app.use(MOUNT_PREFIX, inlineCommentsRouter);
  }, 120_000);

  it('POST /inline-comments without login is rejected with 403', async () => {
    const res = await request(app)
      .post(MOUNT_PREFIX)
      .send({
        pageId: String(new Types.ObjectId()),
        anchorOriginRevisionId: String(new Types.ObjectId()),
        comment: 'x',
        anchor: { quote: 'q', prefix: '', suffix: '', approxOffset: 0 },
      });
    expect(res.status).toBe(403);
  });

  it('POST /inline-comments/:id/replies without login is rejected with 403', async () => {
    const res = await request(app)
      .post(`${MOUNT_PREFIX}/${new Types.ObjectId()}/replies`)
      .send({ comment: 'x' });
    expect(res.status).toBe(403);
  });

  it('GET /inline-comments without login is rejected with 403', async () => {
    const res = await request(app)
      .get(MOUNT_PREFIX)
      .query({ pageId: String(new Types.ObjectId()) });
    expect(res.status).toBe(403);
  });

  it('PUT /inline-comments/:id/resolve without login is rejected with 403', async () => {
    const res = await request(app)
      .put(`${MOUNT_PREFIX}/${new Types.ObjectId()}/resolve`)
      .send({ resolved: true });
    expect(res.status).toBe(403);
  });
});
