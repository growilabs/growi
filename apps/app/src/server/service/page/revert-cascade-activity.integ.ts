/**
 * Integration tests — revertDeletedPage's self pre-create is folded into
 * beginActivity + emit (task 6; read-back-from-real-DB style).
 *
 * Path under test: the REAL pageService.revertDeletedPage (v5 branch, both
 * single-page and recursive) -> beginActivity (mint id + stash context) ->
 * activityEvent.emit('update', ...) -> the REAL ActivityService `update`
 * listener -> settleActivityRecord -> prisma.activities.createByParameters.
 * Unlike v5.public-page.integ.ts's "emits an update activity event" tests,
 * `emit` is NOT mocked here -- the point of this suite is to prove the real
 * listener settles the real action row end-to-end, which is the authoritative
 * evidence design.md requires for the recording gate's core behavior.
 *
 * ACTION_PAGE_REVERT / ACTION_PAGE_RECURSIVELY_REVERT are essential actions
 * (interfaces/activity.ts EssentialActionGroup) and ACTION_PAGE_REVERT is
 * also a contribution action (contribution-graph/interfaces/supported-actions),
 * so both revert actions are always in-gate regardless of
 * app:auditLogActionGroupSize; app:auditLogEnabled is still set explicitly
 * below for parity with the sibling v5 revert suites.
 *
 * Every "row created" assertion READS THE ACTIVITY BACK FROM THE REAL
 * DATABASE (no mocked `emit`, no mocked prisma).
 *
 * Orphan-cleanup coverage note: the "an emit-before-throw does not orphan
 * the pending-context entry" contract (design.md: revertDeletedPage's own
 * catch, and the detached recursive scope's catch, both call
 * `pendingActivityContext.clear`) is covered by *unit* tests in
 * page-delete-activity.spec.ts, which capture the exact minted id (via a
 * mocked beginActivity) and assert `pendingActivityContext.clear` was
 * called with that id. A real-DB reproduction cannot observe the internal,
 * process-local pending-context map's contents without similar
 * instrumentation, so this file instead adds real-DB evidence of the
 * next-best-thing: a genuine PathAlreadyExistsError thrown before any emit
 * leaves NO activity row behind at all (see the third test below).
 *
 * Requires a real MongoDB (wired by vitest.workspace.mts integ setup;
 * per-worker DB isolation via test/setup/mongo + test/setup/prisma).
 *
 * Requirements: 1.2, 3.3
 * Design: service/page/index.ts > revertDeletedPage (Task 6)
 */

import type { IPage, IUserHasId } from '@growi/core';
import { PageGrant } from '@growi/core';
import mongoose, { Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import { PageActionType } from '~/interfaces/page-operation';
import type Crowi from '~/server/crowi';
import type { PageModel } from '~/server/models/page';
import type {
  IPageOperation,
  PageOperationModel,
} from '~/server/models/page-operation';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

// Sentinel ip so cleanup deletes only this suite's activity rows (used
// sentinels in sibling suites: 10.0.0.70/.72/.73/.74/.75/.76/.88/.99,
// 127.0.0.1).
const TEST_IP = '10.0.0.91';
const TEST_ENDPOINT = '/_api/v3/pages/revert-cascade-integ';
const TEST_USERNAME = 'revert-cascade-activity-integ-user';
const SINGLE_PAGE_PATH = '/trash/revert-cascade-activity-integ-single';
const RECURSIVE_PAGE_PATH = '/trash/revert-cascade-activity-integ-recursive';
const CONFLICT_PAGE_PATH = '/trash/revert-cascade-activity-integ-conflict';
const CONFLICT_TARGET_PATH = '/revert-cascade-activity-integ-conflict';

describe('revertDeletedPage — activity recording (read back from real DB, Task 6)', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let PageOperation: PageOperationModel;
  let testUser: IUserHasId;
  let testUserId: Types.ObjectId;

  const waitForRevertPageOperationComplete = async (
    fromPath: string,
    maxWaitMs = 5000,
  ) => {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      const op = await PageOperation.findOne({
        fromPath,
        actionType: PageActionType.Revert,
      });
      if (op == null) {
        return; // the detached recursive-revert scope has completed
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(
      `PageOperation for ${fromPath} did not complete within ${maxWaitMs}ms`,
    );
  };

  /**
   * The `update` listener that settles the real action row runs as an
   * ordinary (non-awaited) EventEmitter listener: `activityEvent.emit(...)`
   * invokes it synchronously up to its first `await`, but revertDeletedPage
   * never awaits the listener's own completion (this is pre-existing
   * EventEmitter behavior, unchanged by task 6 -- every one of the other 37
   * `emit('update', ...)` call sites in the codebase has the same property).
   * So the settled row can still be in flight (contribution lookup, then
   * createByParameters) after `revertDeletedPage` itself has already
   * resolved. Poll instead of asserting immediately.
   */
  const waitForActivityRows = async (
    where: { ip: string },
    maxWaitMs = 5000,
  ) => {
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
  };

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<IPage, PageModel>('Page');
    PageOperation = mongoose.model<IPageOperation, PageOperationModel>(
      'PageOperation',
    );

    // --- Recording gate / branch selection injection (NO process.env mutation) ---
    // app:isV5Compatible steers revertDeletedPage away from the v4 branch
    // (shouldUseV4ProcessForRevert) so the recursive/non-recursive v5 flow
    // under test actually runs. auditLogEnabled is set for parity with the
    // sibling v5 revert suites, though both revert actions are essential
    // and would persist either way.
    await configManager.updateConfigs({
      'app:auditLogEnabled': true,
      'app:isV5Compatible': true,
    });

    const existingRootPage = await Page.findOne({ path: '/' });
    if (existingRootPage == null) {
      await Page.create({ path: '/', grant: PageGrant.GRANT_PUBLIC });
    }

    testUser = await crowi.models.User.create({
      name: 'Revert Cascade Activity Integ User',
      username: TEST_USERNAME,
      email: 'revert-cascade-activity-integ@example.com',
    });
    testUserId = new Types.ObjectId(testUser._id);
  }, 120_000);

  beforeEach(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
    await Page.deleteMany({
      path: {
        $in: [
          SINGLE_PAGE_PATH,
          RECURSIVE_PAGE_PATH,
          CONFLICT_PAGE_PATH,
          CONFLICT_TARGET_PATH,
          Page.getRevertDeletedPageName(SINGLE_PAGE_PATH),
          Page.getRevertDeletedPageName(RECURSIVE_PAGE_PATH),
        ],
      },
    });
    await crowi.models.User.deleteMany({ username: TEST_USERNAME });
    // Remove the injected config rows so later suites in this worker's DB
    // see the pristine (env/default) values again.
    await configManager.updateConfigs(
      {
        'app:auditLogEnabled': undefined,
        'app:isV5Compatible': undefined,
      },
      { removeIfUndefined: true },
    );
  });

  it('req 1.2/3.3 — reverting a single deleted page creates exactly one real ACTION_PAGE_REVERT row carrying the operator, endpoint, and page target (no self pre-create, no lingering ACTION_UNSETTLED)', async () => {
    const [page] = await Page.insertMany([
      {
        path: SINGLE_PAGE_PATH,
        grant: PageGrant.GRANT_PUBLIC,
        creator: testUserId,
        lastUpdateUser: testUserId,
        status: Page.STATUS_DELETED,
        descendantCount: 0,
      },
    ]);

    const revertedPage = await crowi.pageService.revertDeletedPage(
      page,
      testUser,
      {},
      false,
      { ip: TEST_IP, endpoint: TEST_ENDPOINT },
    );

    expect(revertedPage.status).toBe(Page.STATUS_PUBLISHED);

    // Read the settled row back from the real DB -- this is the
    // authoritative evidence that the lazy real-listener path (not a
    // self-pre-create) produced the real action row. Poll: the listener
    // that settles it is not awaited by revertDeletedPage (see
    // waitForActivityRows above).
    const activities = await waitForActivityRows({ ip: TEST_IP });
    expect(activities).toHaveLength(1);

    const [activity] = activities;
    expect(activity.action).toBe(SupportedAction.ACTION_PAGE_REVERT);
    expect(activity.targetModel).toBe(SupportedTargetModel.MODEL_PAGE);
    expect(activity.target).toBe(page._id.toString());
    expect(activity.endpoint).toBe(TEST_ENDPOINT);
    expect(activity.userId).toBe(testUser._id.toString());
    expect(activity.snapshot).toMatchObject({ username: TEST_USERNAME });

    // The self pre-create is folded away: there is no separate
    // ACTION_UNSETTLED row left over from a pre-create step -- the row
    // above already IS the real, settled action.
    const unsettled = activities.filter(
      (row) => row.action === SupportedAction.ACTION_UNSETTLED,
    );
    expect(unsettled).toHaveLength(0);
  });

  it('req 1.2/3.3 — reverting recursively creates exactly one real ACTION_PAGE_RECURSIVELY_REVERT row', async () => {
    // descendantCount > 0 alone selects the recursive action and branch;
    // real descendant pages are not required for that selection (the same
    // trick v5.public-page.integ.ts's recursive-revert activity test uses).
    const [page] = await Page.insertMany([
      {
        path: RECURSIVE_PAGE_PATH,
        grant: PageGrant.GRANT_PUBLIC,
        creator: testUserId,
        lastUpdateUser: testUserId,
        status: Page.STATUS_DELETED,
        descendantCount: 1,
      },
    ]);

    await crowi.pageService.revertDeletedPage(page, testUser, {}, true, {
      ip: TEST_IP,
      endpoint: TEST_ENDPOINT,
    });

    // revertRecursivelyMainOperation (and its emit) runs inside a detached,
    // fire-and-forget async scope; wait for the PageOperation document it
    // manages to clear as a coarse signal that the scope has progressed
    // past its emit.
    await waitForRevertPageOperationComplete(page.path);

    // The listener that settles the row is a separate, non-awaited chain
    // kicked off by that emit (same caveat as the non-recursive test
    // above), so still poll for the row itself rather than reading once.
    const activities = await waitForActivityRows({ ip: TEST_IP });
    expect(activities).toHaveLength(1);

    const [activity] = activities;
    expect(activity.action).toBe(
      SupportedAction.ACTION_PAGE_RECURSIVELY_REVERT,
    );
    expect(activity.targetModel).toBe(SupportedTargetModel.MODEL_PAGE);
    expect(activity.target).toBe(page._id.toString());
    expect(activity.endpoint).toBe(TEST_ENDPOINT);
    expect(activity.userId).toBe(testUser._id.toString());
    expect(activity.snapshot).toMatchObject({ username: TEST_USERNAME });
  });

  it('req 1.2 — a genuine emit-before-throw (PathAlreadyExistsError) persists no activity row at all', async () => {
    // Seed a real, non-empty page already occupying the revert target path
    // so the real v5 flow throws PathAlreadyExistsError BEFORE any
    // activityEvent.emit fires -- a genuine, unmocked "throw before emit"
    // reproduction (design.md: revertDeletedPage's own catch clears the
    // pending context on any throw before its emit; see this file's header
    // comment for why the pending-context map itself is instead asserted
    // by unit tests in page-delete-activity.spec.ts).
    await Page.insertMany([
      {
        path: CONFLICT_TARGET_PATH,
        grant: PageGrant.GRANT_PUBLIC,
        creator: testUserId,
        lastUpdateUser: testUserId,
        status: Page.STATUS_PUBLISHED,
      },
    ]);
    const [page] = await Page.insertMany([
      {
        path: CONFLICT_PAGE_PATH,
        grant: PageGrant.GRANT_PUBLIC,
        creator: testUserId,
        lastUpdateUser: testUserId,
        status: Page.STATUS_DELETED,
        descendantCount: 0,
      },
    ]);

    await expect(
      crowi.pageService.revertDeletedPage(page, testUser, {}, false, {
        ip: TEST_IP,
        endpoint: TEST_ENDPOINT,
      }),
    ).rejects.toThrow(/already_exists|PathAlreadyExists/i);

    // Since the emit never fired, the real listener never ran -- no
    // activity row (settled or otherwise) exists for this failed attempt.
    const activities = await prisma.activities.findMany({
      where: { ip: TEST_IP },
    });
    expect(activities).toHaveLength(0);
  });
});
