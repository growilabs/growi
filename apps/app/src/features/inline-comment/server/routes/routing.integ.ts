/**
 * Routing / real-auth-chain integration tests for the inline-comment feature
 * ("no login" and "no page permission" are both rejected).
 *
 * Unlike the other `*.integ.ts` files in this directory, `accessTokenParser`
 * and `loginRequired` are NOT mocked here — this file exercises the real
 * production middleware chain, mounted at the real production path
 * (`/_api/v3/inline-comments`), to prove what actually happens when nobody is
 * logged in.
 *
 * An unauthenticated caller gets 403, not 401 and not a redirect:
 * `loginRequiredFactory` answers `res.sendStatus(403)` when `req.baseUrl` matches
 * `/^\/_api\/.+$/` (every apiv3 route), and `accessTokenParser` never rejects on
 * its own (an absent or invalid token falls through to `loginRequired`). See
 * `apps/app/src/server/middlewares/login-required.ts` and
 * `apps/app/src/server/routes/apiv3/g2g-transfer-preflight.integ.ts`.
 *
 * The "no page permission" case (authenticated, but lacking view permission
 * on the target page) is covered per-route in create.integ.ts /
 * create-reply.integ.ts / resolve.integ.ts, each asserting a
 * uniform 404 per apps/app/.claude/rules/page-write-action-403-404.md.
 *
 * Every write route (create, create-reply, resolve, update, update-reply,
 * delete, delete-reply) gets the same "no login" real-auth-chain check. The
 * list URL (GET /inline-comments) is not served and answers with a JSON 404.
 *
 * Requirements: 1.5, 1.6, 6.1, 18.3, 18.7
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ErrorV3 } from '@growi/core/dist/models';
import express from 'express';
import { Types } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';

import { createInlineCommentRouteHandlersFactory } from './create';
import { createInlineCommentReplyRouteHandlersFactory } from './create-reply';
import { deleteInlineCommentRouteHandlersFactory } from './delete';
import { deleteInlineCommentReplyRouteHandlersFactory } from './delete-reply';
import { resolveInlineCommentRouteHandlersFactory } from './resolve';
import { updateInlineCommentRouteHandlersFactory } from './update';
import { updateInlineCommentReplyRouteHandlersFactory } from './update-reply';

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
    inlineCommentsRouter.put(
      '/:id/resolve',
      resolveInlineCommentRouteHandlersFactory(crowi),
    );
    inlineCommentsRouter.put(
      '/:id',
      updateInlineCommentRouteHandlersFactory(crowi),
    );
    inlineCommentsRouter.put(
      '/replies/:id',
      updateInlineCommentReplyRouteHandlersFactory(crowi),
    );
    inlineCommentsRouter.delete(
      '/:id',
      deleteInlineCommentRouteHandlersFactory(crowi),
    );
    inlineCommentsRouter.delete(
      '/replies/:id',
      deleteInlineCommentReplyRouteHandlersFactory(crowi),
    );
    app.use(MOUNT_PREFIX, inlineCommentsRouter);
    // Mirrors the explicit 404 registered right after the router mount in
    // apps/app/src/server/routes/apiv3/index.js.
    app.get(MOUNT_PREFIX, (_req, res: ApiV3Response) =>
      res.apiv3Err(new ErrorV3('Not found', 'not_found'), 404),
    );
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

  it('answers GET /inline-comments with a JSON 404', async () => {
    const res = await request(app)
      .get(MOUNT_PREFIX)
      .query({ pageId: String(new Types.ObjectId()) });
    expect(res.status).toBe(404);
    expect(res.body.errors[0].code).toBe('not_found');
  });

  // apiv3 has no catch-all, so without the explicit 404 an unmatched GET falls
  // through to the Next.js page delegation (302 to /login or an HTML 200).
  it('registers the explicit 404 for GET /inline-comments and no list handler in production', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../../../../server/routes/apiv3/index.js'),
      'utf8',
    );
    expect(source).toContain(
      "router.use('/inline-comments', inlineCommentsRouter)",
    );
    expect(source).toMatch(
      /router\.get\(\s*'\/inline-comments'[\s\S]*?apiv3Err\([\s\S]*?404/,
    );
    expect(source).not.toMatch(/inlineCommentsRouter\.get\(/);
    expect(source).not.toContain('inline-comment/server/routes/list');
    expect(source).not.toContain('listInlineCommentsRouteHandlersFactory');
  });

  it('PUT /inline-comments/:id/resolve without login is rejected with 403', async () => {
    const res = await request(app)
      .put(`${MOUNT_PREFIX}/${new Types.ObjectId()}/resolve`)
      .send({ resolved: true });
    expect(res.status).toBe(403);
  });

  it('PUT /inline-comments/:id without login is rejected with 403', async () => {
    const res = await request(app)
      .put(`${MOUNT_PREFIX}/${new Types.ObjectId()}`)
      .send({ comment: 'edited' });
    expect(res.status).toBe(403);
  });

  it('PUT /inline-comments/replies/:id without login is rejected with 403', async () => {
    const res = await request(app)
      .put(`${MOUNT_PREFIX}/replies/${new Types.ObjectId()}`)
      .send({ comment: 'edited' });
    expect(res.status).toBe(403);
  });

  it('DELETE /inline-comments/:id without login is rejected with 403', async () => {
    const res = await request(app).delete(
      `${MOUNT_PREFIX}/${new Types.ObjectId()}`,
    );
    expect(res.status).toBe(403);
  });

  it('DELETE /inline-comments/replies/:id without login is rejected with 403', async () => {
    const res = await request(app).delete(
      `${MOUNT_PREFIX}/replies/${new Types.ObjectId()}`,
    );
    expect(res.status).toBe(403);
  });
});
