/**
 * Integration test — update-page must emit the update activity BEFORE the
 * response is sent, so the settled activity row keeps its operator (`user`).
 *
 * Root cause this guards against (see update-page.ts > generateUpdateActivity):
 *   The activity's request context (userId / ip / endpoint / username) lives in
 *   the process-local `pendingActivityContext`, keyed by the pre-minted id, and
 *   `registerFailsafeFinalizer` clears that entry on the `res` 'finish'/'close'
 *   events. The ActivityService 'update' listener consumes the context
 *   synchronously (`pendingActivityContext.take`). If the emit ran AFTER
 *   `res.apiv3()` (as it used to, from inside `postAction`, behind an
 *   `await shouldGenerateUpdate(...)`), the response's 'finish' could clear the
 *   context first, so the row settled with `user: null` -- a "bare" activity
 *   that later surfaced as a `null` entry in a notification's `actionUsers`
 *   and crashed the notification list (PR #11510).
 *
 * The fake `res` below fires 'finish' SYNCHRONOUSLY from `apiv3()`, so the
 * finalizer clears the context the instant the response is sent. This makes the
 * ordering deterministic: only emitting before `apiv3()` can preserve the
 * operator. With the pre-fix ordering this test is RED (userId === null); with
 * the fix it is GREEN.
 *
 * Path under test (real, unmocked emit/listener/settle/prisma): the REAL
 * update-page terminal handler -> generateUpdateActivity -> shouldGenerateUpdate
 * -> crowi.events.activity.emit('update') -> the REAL ActivityService listener
 * -> pendingActivityContext.take -> settleActivityRecord ->
 * prisma.activities.createByParameters. Only the page-persistence collaborators
 * (Page.count / Page.findByIdAndViewer / Revision.findById /
 * pageService.updatePage) are stubbed so the test does not depend on the v5
 * page-tree setup; the activity lifecycle is exercised end-to-end.
 *
 * Requires a real MongoDB (wired by vitest.workspace.mts integ setup;
 * per-worker DB isolation via test/setup/mongo + test/setup/prisma).
 */

import { EventEmitter } from 'node:events';
import type { IPage, IUserHasId } from '@growi/core';
import type { RequestHandler } from 'express';
import mongoose, { Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { ActionGroupSize, SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import type { PageModel } from '~/server/models/page';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import type { ApiV3Response } from '../interfaces/apiv3-response';
import { updatePageHandlersFactory } from './update-page';

// Sentinel ip so cleanup deletes only this suite's activity rows (avoid the
// sentinels used by sibling activity suites -- see record-gate.integ.ts).
const TEST_IP = '10.0.0.111';
const TEST_ENDPOINT = '/_api/v3/page/update-page-integ';
const TEST_USERNAME = 'update-page-integ-user';

/** Poll `activities` until at least one row matches `where` (the settle listener
 * that creates the row is a detached, non-awaited EventEmitter callback). */
async function waitForActivityRows(
  where: { id: string },
  maxWaitMs = 5000,
): Promise<Awaited<ReturnType<typeof prisma.activities.findMany>>> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    const rows = await prisma.activities.findMany({ where });
    if (rows.length > 0) {
      return rows;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `no activity row appeared within ${maxWaitMs}ms for ${JSON.stringify(where)}`,
  );
}

describe('update-page — emits the update activity before the response (PR #11510 root cause)', () => {
  let crowi: Crowi;
  let testUser: IUserHasId;
  let testUserId: Types.ObjectId;

  beforeAll(async () => {
    crowi = await getInstance();

    testUser = await crowi.models.User.create({
      name: 'Update Page Integ User',
      username: TEST_USERNAME,
      email: 'update-page-integ@example.com',
    });
    testUserId = new Types.ObjectId(testUser._id);
  }, 120_000);

  beforeEach(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });

    // ACTION_PAGE_UPDATE must be in-gate so settleActivityRecord persists it.
    await configManager.updateConfigs({
      'app:auditLogEnabled': true,
      'app:auditLogActionGroupSize': ActionGroupSize.Large,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
    await crowi.models.User.deleteMany({ username: TEST_USERNAME });
    await configManager.updateConfigs(
      {
        'app:auditLogEnabled': undefined,
        'app:auditLogActionGroupSize': undefined,
      },
      { removeIfUndefined: true },
    );
  });

  it('settles the PAGE_UPDATE activity with the operator even when the response finishes immediately', async () => {
    const pageId = new Types.ObjectId();
    const revisionId = new Types.ObjectId();

    // Stub page-persistence collaborators so the test does not need the v5
    // page-tree; the activity lifecycle downstream of the emit stays real.
    const Page = mongoose.model<IPage, PageModel>('Page');
    const Revision = mongoose.model('Revision');

    const currentPage = {
      _id: pageId,
      path: '/update-page-integ-target',
      grant: 1,
      revision: revisionId,
      isUpdatable: vi.fn().mockResolvedValue(true),
    };
    const updatedPage = {
      _id: pageId,
      path: '/update-page-integ-target',
      creator: testUserId,
      revision: {
        _id: new Types.ObjectId(),
        body: 'updated',
        author: testUserId,
      },
    };

    vi.spyOn(Page, 'count').mockResolvedValue(1);
    // biome-ignore lint/suspicious/noExplicitAny: minimal stub for the viewer lookup
    vi.spyOn(Page, 'findByIdAndViewer').mockResolvedValue(currentPage as any);
    // biome-ignore lint/suspicious/noExplicitAny: minimal stub for the previous revision
    vi.spyOn(Revision, 'findById').mockResolvedValue({
      _id: revisionId,
      body: 'prev',
    } as any);
    // biome-ignore lint/suspicious/noExplicitAny: minimal stub for the page update
    vi.spyOn(crowi.pageService, 'updatePage').mockResolvedValue(
      updatedPage as any,
    );
    // Note: postAction's global/user notifications run detached AFTER the
    // response inside their own try/catch, so they are irrelevant to (and
    // cannot fail) the activity lifecycle under test even when the test crowi
    // has no notification services wired.

    // Fake response: apiv3() fires 'finish' synchronously to reproduce the
    // context-clearing race the fix must survive. ApiV3Response extends the
    // Express Response (50+ members); only the members the handler and the
    // add-activity finalizer touch are implemented, so a plain object cast is
    // used (same approach as respond-with-single-page.spec.ts).
    const emitter = new EventEmitter();
    const resState = { statusCode: 200 };
    const apiv3 = vi.fn(() => {
      resState.statusCode = 201;
      // Fire 'finish' the instant the response is sent so the finalizer clears
      // the pending context immediately (deterministic race reproduction).
      emitter.emit('finish');
    });
    const res = {
      locals: {} as Record<string, unknown>,
      writableFinished: false,
      get statusCode() {
        return resState.statusCode;
      },
      on: emitter.on.bind(emitter),
      apiv3,
      apiv3Err: vi.fn(),
    } as unknown as ApiV3Response;

    const emitSpy = vi.spyOn(crowi.events.activity, 'emit');

    // Build the request as the middleware chain would see it.
    const req = {
      method: 'PUT',
      ip: TEST_IP,
      originalUrl: TEST_ENDPOINT,
      user: testUser,
      body: {
        pageId: pageId.toString(),
        body: 'updated body',
        origin: 'editor',
      },
      // biome-ignore lint/suspicious/noExplicitAny: minimal Express request shape
    } as any;

    // Run the real add-activity middleware to mint the id, stash the context,
    // and wire the fail-safe finalizer onto our fake res.
    const addActivity = generateAddActivityMiddleware();
    addActivity(req, res, () => {});

    const activityId = res.locals.activity._id as string;

    // Invoke the REAL terminal handler.
    const handlers = updatePageHandlersFactory(crowi);
    const terminalHandler = handlers[handlers.length - 1] as RequestHandler;
    await terminalHandler(req, res, () => {});

    // The emit must have happened before the response was sent.
    const updateEmitCall = emitSpy.mock.calls.findIndex(
      (call) => call[0] === 'update',
    );
    expect(updateEmitCall).toBeGreaterThanOrEqual(0);
    const updateEmitOrder = emitSpy.mock.invocationCallOrder[updateEmitCall];
    const apiv3Order = apiv3.mock.invocationCallOrder[0];
    expect(updateEmitOrder).toBeLessThan(apiv3Order);

    // End-to-end: the settled row must carry the operator, not null.
    const rows = await waitForActivityRows({ id: activityId });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe(SupportedAction.ACTION_PAGE_UPDATE);
    expect(rows[0].userId).toBe(testUserId.toHexString());
  });
});
