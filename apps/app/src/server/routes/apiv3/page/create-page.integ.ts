/**
 * Drift guard — create-page must emit the create activity BEFORE the response
 * finishes, so the settled activity row keeps its operator (`user`).
 *
 * create-page emits `ACTION_PAGE_CREATE` from `generateCreateActivity()`, called
 * before `res.apiv3()`, so the ActivityService listener's synchronous
 * `pendingActivityContext.take()` runs while the request context is still alive.
 * Historically this emit sat at the top of `postAction` (after `res.apiv3()`)
 * and was safe only because nothing `await`ed between the two -- a fragile
 * property. It was moved ahead of the response precisely so it can no longer
 * regress into the update-page-style null-user bug (see update-page.integ.ts
 * and PR #11510). This test locks that ordering in: if the emit is ever moved
 * back after `res.apiv3()`, or an `await` is inserted before it, the context is
 * cleared first and the row settles with `user: null`, and this test goes RED.
 *
 * The fake `res` fires 'finish' SYNCHRONOUSLY from `apiv3()`, so the finalizer
 * clears the context the instant the response is sent: only emitting before
 * `apiv3()` can preserve the operator.
 *
 * Path under test (real, unmocked emit/listener/settle/prisma): the REAL
 * create-page terminal handler -> generateCreateActivity ->
 * crowi.events.activity.emit('update') -> the REAL ActivityService listener ->
 * pendingActivityContext.take -> settleActivityRecord ->
 * prisma.activities.createByParameters. Only the page-persistence collaborators
 * (pageService.create / PageTagRelation) are stubbed so the test does not depend
 * on the v5 page-tree setup.
 *
 * Requires a real MongoDB (wired by vitest.workspace.mts integ setup).
 */

import { EventEmitter } from 'node:events';
import type { IUserHasId } from '@growi/core';
import type { RequestHandler } from 'express';
import { Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { ActionGroupSize, SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import PageTagRelation from '~/server/models/page-tag-relation';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import type { ApiV3Response } from '../interfaces/apiv3-response';
import { createPageHandlersFactory } from './create-page';

const TEST_IP = '10.0.0.112';
const TEST_ENDPOINT = '/_api/v3/page/create-page-integ';
const TEST_USERNAME = 'create-page-integ-user';

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

describe('create-page — emits the create activity before the response (PR #11510 drift guard)', () => {
  let crowi: Crowi;
  let testUser: IUserHasId;
  let testUserId: Types.ObjectId;

  beforeAll(async () => {
    crowi = await getInstance();

    testUser = await crowi.models.User.create({
      name: 'Create Page Integ User',
      username: TEST_USERNAME,
      email: 'create-page-integ@example.com',
    });
    testUserId = new Types.ObjectId(testUser._id);
  }, 120_000);

  beforeEach(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });

    // ACTION_PAGE_CREATE must be in-gate so settleActivityRecord persists it.
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

  it('settles the PAGE_CREATE activity with the operator even when the response finishes immediately', async () => {
    const pageId = new Types.ObjectId();

    const createdPage = {
      _id: pageId,
      id: pageId.toString(),
      path: '/create-page-integ-target',
      creator: testUserId,
      revision: {
        _id: new Types.ObjectId(),
        body: 'created',
        author: testUserId,
      },
    };

    // Stub page-persistence collaborators; the activity lifecycle stays real.
    // biome-ignore lint/suspicious/noExplicitAny: minimal stub for the page create
    vi.spyOn(crowi.pageService, 'create').mockResolvedValue(createdPage as any);
    vi.spyOn(PageTagRelation, 'updatePageTags').mockResolvedValue(
      // biome-ignore lint/suspicious/noExplicitAny: return value is unused by the handler
      undefined as any,
    );
    vi.spyOn(PageTagRelation, 'listTagNamesByPage').mockResolvedValue([]);

    // Fake response: apiv3() fires 'finish' synchronously to reproduce the
    // context-clearing race the ordering must survive.
    const emitter = new EventEmitter();
    const resState = { statusCode: 200 };
    const apiv3 = vi.fn(() => {
      resState.statusCode = 201;
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

    const req = {
      method: 'POST',
      ip: TEST_IP,
      originalUrl: TEST_ENDPOINT,
      user: testUser,
      body: {
        path: '/create-page-integ-target',
        body: 'created body',
        origin: 'editor',
      },
      // biome-ignore lint/suspicious/noExplicitAny: minimal Express request shape
    } as any;

    const addActivity = generateAddActivityMiddleware();
    addActivity(req, res, () => {});

    const activityId = res.locals.activity._id as string;

    const handlers = createPageHandlersFactory(crowi);
    const terminalHandler = handlers[handlers.length - 1] as RequestHandler;
    await terminalHandler(req, res, () => {});

    // The activity emit must precede the response being sent.
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
    expect(rows[0].action).toBe(SupportedAction.ACTION_PAGE_CREATE);
    expect(rows[0].userId).toBe(testUserId.toHexString());
  });
});
