/**
 * Integration tests — activity-log recording gate, feature-level acceptance
 * suite (tasks.md Task 7.1–7.4; real replica-set DB, no mocked emit/prisma).
 *
 * This is the single shared integ file for sub-tasks 7.1–7.4 (tasks.md:
 * "7.1–7.4 は共有セットアップ … のため同一の integ ファイルに置き、並列にはしない").
 * Each sub-task owns one or more `it`s inside its own `describe`, all sharing
 * the per-worker DB, the one `crowi` instance, and the one `testUser` set up
 * in `beforeAll` below.
 *
 * Path under test (real, unmocked):
 *   beginActivity(context) [mint id + stash context in the process-local map]
 *   -> crowi.events.activity.emit('update', activityId, parameters)
 *   -> the REAL ActivityService `update` listener (service/activity.ts)
 *      -> pendingActivityContext.take (sync) -> contribution (if applicable)
 *      -> shoudUpdateActivity gate -> settleActivityRecord
 *      -> prisma.activities.createByParameters (only when in-gate)
 * and, for the fail-safe path:
 *   registerFailsafeFinalizer(fakeRes, activityId, context)
 *   -> fakeRes 'finish'/'close' -> recordFailsafeAttempt
 *      -> prisma.activities.createByParameters(ACTION_UNSETTLED)
 *
 * `activityEvent.emit('update', ...)` is never awaited by any of its 37+
 * call sites in the codebase (tasks.md Implementation Note 5/6/7.x), so the
 * row a real emit produces can still be in flight after the emit call
 * returns. Every assertion that expects a row to exist THEREFORE POLLS
 * (`waitForActivityRows`) rather than reading immediately.
 *
 * Proving a row's ABSENCE ("no write ever happens") cannot be done by
 * waiting an arbitrary fixed delay -- that only proves "not observed within
 * N ms". Instead, most negative assertions here pair the action under test
 * with a companion action that DOES persist, and wait for the companion's
 * row first. The out-of-gate/no-op paths under test (settleActivityRecord's
 * null branch, `registerFailsafeFinalizer`'s skipped-attempt branch) never
 * touch the DB at all -- no `await` is scheduled for them -- so by the time
 * the companion's real Prisma round trip has landed, the decision not to
 * write has already been made. This is a causal-ordering proof, not a race.
 *
 * Recording gate configuration is injected exclusively through
 * `configManager.updateConfigs` (DB-backed; `crowi.configManager` and the
 * directly-imported `configManager` are the same module singleton --
 * verified against `server/crowi/index.ts` setupConfigManager). `process.env`
 * is never mutated (steering: `feedback_avoid_env_mutation_explicit_injection`).
 *
 * Requires a real MongoDB (wired by vitest.workspace.mts integ setup;
 * per-worker DB isolation via test/setup/mongo + test/setup/prisma).
 *
 * Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.4, 2.5, 2.6, 4.1, 4.2, 4.3
 * Design: Testing Strategy > Integration Tests; System Flows > 更新系リクエストの
 *   記録ライフサイクル（正常系 settle シーケンス）／失敗・中断時の fail-safe
 *   （finalizer シーケンス）
 */

import { EventEmitter } from 'node:events';
import type { IUserHasId } from '@growi/core';
import type { Response } from 'express';
import { Types } from 'mongoose';
import { mock } from 'vitest-mock-extended';

import { getInstance } from '^/test/setup/crowi';

import Contribution from '~/features/contribution-graph/server/models/contribution-model';
import {
  ActionGroupSize,
  AllEssentialActions,
  SupportedAction,
} from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import { beginActivity } from './begin-activity';
import type { PendingActivityContext } from './pending-activity-context';
import { registerFailsafeFinalizer } from './register-failsafe-finalizer';

// Sentinel ip so cleanup deletes only this suite's activity rows (used
// sentinels in sibling suites: 10.0.0.55/.56/.57/.70/.71/.72/.73/.74/.75/.76/
// .78/.87/.88/.91/.99, 127.0.0.1).
const TEST_IP = '10.0.0.92';
const TEST_ENDPOINT = '/_api/v3/record-gate-integ';
const TEST_USERNAME = 'record-gate-integ-user';

/** Build a request-time context distinct from "now", so a settle-time
 * regression (using the settle/finalizer timestamp instead of the arrival
 * time) would fail any `createdAt` assertion below. */
function buildContext(
  userId: string,
  overrides: Partial<PendingActivityContext> = {},
): PendingActivityContext {
  return {
    ip: TEST_IP,
    endpoint: TEST_ENDPOINT,
    userId,
    username: TEST_USERNAME,
    createdAt: new Date(Date.now() - 60_000),
    ...overrides,
  };
}

/**
 * Poll `activities` until at least one row matches `where`. The listener
 * that creates the row is a detached (non-awaited) EventEmitter callback
 * (see file header), so a positive read must poll rather than read once.
 */
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

async function waitForContribution(
  userId: Types.ObjectId,
  date: Date,
  maxWaitMs = 5000,
) {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    const doc = await Contribution.findOne({ user: userId, date });
    if (doc != null) {
      return doc;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`no contribution row appeared within ${maxWaitMs}ms`);
}

/**
 * A fake `res` that is a *real* EventEmitter under `on` -- a plain
 * `mock<Response>()` auto-stubs `on` as a no-op, so listeners
 * `registerFailsafeFinalizer` registers would never actually fire. The cast
 * is localized to just the `on` field (essential-test-patterns Tier 2);
 * everything else on the returned object stays a type-safe `mock<Response>()`
 * (mirrors register-failsafe-finalizer.spec.ts's helper, reused here at the
 * integration level with the REAL recordFailsafeAttempt/prisma behind it).
 */
function buildFakeRes(overrides: {
  statusCode: number;
  writableFinished: boolean;
}): { res: Response; emitter: EventEmitter } {
  const emitter = new EventEmitter();
  const res = mock<Response>({
    ...overrides,
    on: emitter.on.bind(emitter) as Response['on'],
  });
  return { res, emitter };
}

describe('activity-log record gate — feature-level integration (Task 7.1–7.4)', () => {
  let crowi: Crowi;
  let testUser: IUserHasId;
  let testUserId: Types.ObjectId;

  beforeAll(async () => {
    crowi = await getInstance();

    testUser = await crowi.models.User.create({
      name: 'Record Gate Integ User',
      username: TEST_USERNAME,
      email: 'record-gate-integ@example.com',
    });
    testUserId = new Types.ObjectId(testUser._id);
  }, 120_000);

  beforeEach(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });

    // Baseline recording-gate config for this suite: enabled, Small group
    // (individual tests below override this locally where needed).
    await configManager.updateConfigs({
      'app:auditLogEnabled': true,
      'app:auditLogActionGroupSize': ActionGroupSize.Small,
    });
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
    await Contribution.deleteMany({ user: testUserId });
    await crowi.models.User.deleteMany({ username: TEST_USERNAME });
    // Remove the injected config rows so later suites in this worker's DB
    // see the pristine (env/default) values again.
    await configManager.updateConfigs(
      {
        'app:auditLogEnabled': undefined,
        'app:auditLogActionGroupSize': undefined,
      },
      { removeIfUndefined: true },
    );
  });

  // ---------------------------------------------------------------------
  // 7.1 — out-of-gate is never persisted; in-gate/essential is persisted
  // (Requirements 1.1, 1.2, 2.1, 2.2)
  // ---------------------------------------------------------------------
  describe('7.1 — record-target gate (real DB read-back)', () => {
    it('req 1.1 — an out-of-gate action (non-essential, outside the configured small group) settles without ever writing a row', async () => {
      const outContext = buildContext(testUserId.toHexString());
      const { activityId: outOfGateId } = beginActivity(outContext);
      crowi.events.activity.emit('update', outOfGateId, {
        action: SupportedAction.ACTION_ADMIN_APP_SETTINGS_UPDATE, // Large-only, not essential
      });

      // Causal-ordering proof of absence (see file header): the out-of-gate
      // branch never touches the DB, so waiting for an in-gate companion's
      // real write guarantees the decision above has already been made.
      const companionContext = buildContext(testUserId.toHexString());
      const { activityId: companionId } = beginActivity(companionContext);
      crowi.events.activity.emit('update', companionId, {
        action: SupportedAction.ACTION_PAGE_EMPTY_TRASH, // Small group, in-gate
      });
      await waitForActivityRows({ id: companionId });

      const outRows = await prisma.activities.findMany({
        where: { id: outOfGateId },
      });
      expect(outRows).toHaveLength(0);
    });

    it('req 1.2 — an in-gate, non-essential action (within the configured small group) is persisted as the real action', async () => {
      const context = buildContext(testUserId.toHexString());
      const { activityId } = beginActivity(context);

      crowi.events.activity.emit('update', activityId, {
        action: SupportedAction.ACTION_PAGE_EMPTY_TRASH,
      });

      const [row] = await waitForActivityRows({ id: activityId });
      expect(row.action).toBe(SupportedAction.ACTION_PAGE_EMPTY_TRASH);
      expect(row.ip).toBe(TEST_IP);
      expect(row.endpoint).toBe(TEST_ENDPOINT);
    });

    describe('with app:auditLogEnabled=false', () => {
      beforeEach(async () => {
        await configManager.updateConfigs({ 'app:auditLogEnabled': false });
      });

      it('req 2.1/2.2 — persists only essential actions; a non-essential in-small-group action does not persist', async () => {
        const essentialContext = buildContext(testUserId.toHexString());
        const { activityId: essentialId } = beginActivity(essentialContext);
        crowi.events.activity.emit('update', essentialId, {
          action: SupportedAction.ACTION_PAGE_BOOKMARK, // essential, not in SmallActionGroup
        });

        const nonEssentialContext = buildContext(testUserId.toHexString());
        const { activityId: nonEssentialId } =
          beginActivity(nonEssentialContext);
        crowi.events.activity.emit('update', nonEssentialId, {
          action: SupportedAction.ACTION_PAGE_EMPTY_TRASH, // non-essential
        });

        const [essentialRow] = await waitForActivityRows({
          id: essentialId,
        });
        expect(essentialRow.action).toBe(SupportedAction.ACTION_PAGE_BOOKMARK);

        // Causal-ordering proof of absence: waiting for the essential row
        // above already guarantees enough time has passed for the
        // non-essential branch's no-write decision to have completed.
        const nonEssentialRows = await prisma.activities.findMany({
          where: { id: nonEssentialId },
        });
        expect(nonEssentialRows).toHaveLength(0);
      });
    });
  });

  // ---------------------------------------------------------------------
  // 7.2 — the persisted row keeps the operation context, including the
  // arrival-time createdAt (Requirement 2.6)
  // ---------------------------------------------------------------------
  describe('7.2 — persisted row retains operation context (real DB read-back)', () => {
    it('req 2.6 — the persisted row carries operator, operator name, ip, endpoint, and the request ARRIVAL time as createdAt (not settle time)', async () => {
      // 5 minutes before "now": far enough from wall-clock settle time that
      // a settle-time regression cannot pass this assertion by coincidence.
      const arrivalTime = new Date(Date.now() - 5 * 60_000);
      const context = buildContext(testUserId.toHexString(), {
        createdAt: arrivalTime,
      });
      const { activityId } = beginActivity(context);

      crowi.events.activity.emit('update', activityId, {
        action: SupportedAction.ACTION_PAGE_EMPTY_TRASH,
      });

      const [row] = await waitForActivityRows({ id: activityId });
      expect(row.userId).toBe(testUserId.toHexString());
      expect(row.snapshot.username).toBe(TEST_USERNAME);
      expect(row.ip).toBe(TEST_IP);
      expect(row.endpoint).toBe(TEST_ENDPOINT);
      expect(row.createdAt.getTime()).toBe(arrivalTime.getTime());
      // Extra guard against a settle-time regression: the settle/poll wall
      // clock is always within the last minute of "now", far later than
      // arrivalTime.
      expect(row.createdAt.getTime()).toBeLessThan(Date.now() - 60_000);
    });
  });

  // ---------------------------------------------------------------------
  // 7.3 — fail-safe attempt records, their distinction from out-of-gate,
  // and no accidental sweep of a live pending entry
  // (Requirements 4.1, 4.2, 4.3, 2.6)
  // ---------------------------------------------------------------------
  describe('7.3 — fail-safe attempt recording (real DB read-back)', () => {
    it('req 4.1/4.3 — a failed response (status>=400) leaves an ACTION_UNSETTLED attempt row; a successful response (status<400) leaves none', async () => {
      const successContext = buildContext(testUserId.toHexString());
      const { activityId: successId } = beginActivity(successContext);
      const { res: successRes, emitter: successEmitter } = buildFakeRes({
        statusCode: 200,
        writableFinished: true,
      });
      registerFailsafeFinalizer(successRes, successId, successContext);
      successEmitter.emit('finish'); // success path: no recordFailsafeAttempt call at all, so no DB write is ever scheduled

      const failContext = buildContext(testUserId.toHexString());
      const { activityId: failId } = beginActivity(failContext);
      const { res: failRes, emitter: failEmitter } = buildFakeRes({
        statusCode: 500,
        writableFinished: true,
      });
      registerFailsafeFinalizer(failRes, failId, failContext);
      failEmitter.emit('finish');

      // Causal-ordering proof of absence: the failure path's real DB write
      // strictly outlasts the success path's synchronous no-op, so once the
      // failure row is observed, the success path has certainly already
      // decided (and skipped) its write.
      const [failRow] = await waitForActivityRows({ id: failId });
      expect(failRow.action).toBe(SupportedAction.ACTION_UNSETTLED);
      expect(failRow.ip).toBe(TEST_IP);
      expect(failRow.userId).toBe(testUserId.toHexString());

      const successRows = await prisma.activities.findMany({
        where: { id: successId },
      });
      expect(successRows).toHaveLength(0);
    });

    it('req 4.1/4.3 — a client interruption (close event, writableFinished=false) also leaves an ACTION_UNSETTLED attempt row', async () => {
      const context = buildContext(testUserId.toHexString());
      const { activityId } = beginActivity(context);
      const { res, emitter } = buildFakeRes({
        statusCode: 200,
        writableFinished: false,
      });
      registerFailsafeFinalizer(res, activityId, context);
      emitter.emit('close');

      const [row] = await waitForActivityRows({ id: activityId });
      expect(row.action).toBe(SupportedAction.ACTION_UNSETTLED);
      expect(row.endpoint).toBe(TEST_ENDPOINT);
    });

    it('req 4.2 — a settled-but-out-of-gate action leaves no row, while a failed attempt for a different request leaves an ACTION_UNSETTLED row', async () => {
      const outContext = buildContext(testUserId.toHexString());
      const { activityId: outOfGateId } = beginActivity(outContext);
      crowi.events.activity.emit('update', outOfGateId, {
        action: SupportedAction.ACTION_ADMIN_APP_SETTINGS_UPDATE,
      });

      const failContext = buildContext(testUserId.toHexString());
      const { activityId: failId } = beginActivity(failContext);
      const { res, emitter } = buildFakeRes({
        statusCode: 503,
        writableFinished: true,
      });
      registerFailsafeFinalizer(res, failId, failContext);
      emitter.emit('finish');

      const [failRow] = await waitForActivityRows({ id: failId });
      expect(failRow.action).toBe(SupportedAction.ACTION_UNSETTLED);

      const outRows = await prisma.activities.findMany({
        where: { id: outOfGateId },
      });
      expect(outRows).toHaveLength(0);
    });

    it('req 2.6 — a context stashed by beginActivity survives a delay before the settling emit (no accidental sweep of a live pending entry)', async () => {
      const arrivalTime = new Date(Date.now() - 30_000);
      const context = buildContext(testUserId.toHexString(), {
        createdAt: arrivalTime,
      });
      const { activityId } = beginActivity(context);

      // Simulate a slow, still-in-flight request: pending-activity-context.ts
      // has no time-based eviction (only explicit set/take/clear), so a
      // delay here between mint+stash and the settling emit must not lose
      // the context. This is a smoke-level corroboration of that structural
      // invariant, not a multi-minute reproduction.
      await new Promise((resolve) => setTimeout(resolve, 250));

      crowi.events.activity.emit('update', activityId, {
        action: SupportedAction.ACTION_PAGE_EMPTY_TRASH,
      });

      const [row] = await waitForActivityRows({ id: activityId });
      expect(row.ip).toBe(TEST_IP);
      expect(row.endpoint).toBe(TEST_ENDPOINT);
      expect(row.userId).toBe(testUserId.toHexString());
      expect(row.snapshot.username).toBe(TEST_USERNAME);
      expect(row.createdAt.getTime()).toBe(arrivalTime.getTime());
    });
  });

  // ---------------------------------------------------------------------
  // 7.4 — non-regression: contribution, GET path, group/essential config
  // (Requirements 1.3, 2.4, 2.5)
  // ---------------------------------------------------------------------
  describe('7.4 — non-regression of contribution / GET path / group config', () => {
    it('req 2.4 — contribution still runs for a contribution action even when settle fails to persist the row (contribution is unaffected by the record gate)', async () => {
      const context = buildContext(testUserId.toHexString());
      const { activityId } = beginActivity(context);

      // Force settle's create to collide with an ALREADY-existing row under
      // the same pre-minted id -- the rare race the design accepts (Issue 1)
      // -- so settleActivityRecord's create is guaranteed to fail with a
      // duplicate-key error and the listener's try/catch swallows it without
      // ever persisting the real action. This isolates contribution's
      // success from settle's outcome, which a happy-path emit could not:
      // contribution actions are all essential (always in-gate), so a
      // genuine "out-of-gate contribution action" cannot be reached through
      // public config (see CONCERNS).
      await prisma.activities.createByParameters({
        id: activityId,
        action: SupportedAction.ACTION_UNSETTLED,
        ip: context.ip,
        endpoint: context.endpoint,
        createdAt: context.createdAt,
        user: context.userId,
        snapshot: { username: context.username },
      });

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      await Contribution.deleteOne({ user: testUserId, date: today });

      crowi.events.activity.emit('update', activityId, {
        action: SupportedAction.ACTION_PAGE_CREATE,
        contributor: testUser,
      });

      // Contribution runs BEFORE settle and is unconditional of
      // record-eligibility (service/activity.ts) -- poll it independently
      // of the (guaranteed-to-fail) activity row.
      const contribution = await waitForContribution(testUserId, today);
      expect(contribution.count).toBe(1);

      // Confirm settle genuinely failed to persist the real action: the
      // pre-created row is untouched, so contribution's success above is
      // NOT a side effect of settle having succeeded.
      const rows = await prisma.activities.findMany({
        where: { id: activityId },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe(SupportedAction.ACTION_UNSETTLED);
    });

    it('req 1.3 — ActivityService.createActivity (GET path) is unchanged: creates a row for an in-gate action, creates nothing for an out-of-gate action', async () => {
      const inGateId = new Types.ObjectId().toString();
      const created = await crowi.activityService.createActivity({
        id: inGateId,
        action: SupportedAction.ACTION_PAGE_EMPTY_TRASH,
        ip: TEST_IP,
        endpoint: TEST_ENDPOINT,
        user: testUserId.toHexString(),
        snapshot: { username: TEST_USERNAME },
      });
      expect(created).not.toBeNull();
      const inGateRows = await prisma.activities.findMany({
        where: { id: inGateId },
      });
      expect(inGateRows).toHaveLength(1);

      const outOfGateId = new Types.ObjectId().toString();
      const result = await crowi.activityService.createActivity({
        id: outOfGateId,
        action: SupportedAction.ACTION_ADMIN_APP_SETTINGS_UPDATE,
        ip: TEST_IP,
        endpoint: TEST_ENDPOINT,
        user: testUserId.toHexString(),
        snapshot: { username: TEST_USERNAME },
      });
      expect(result).toBeNull();
      const outOfGateRows = await prisma.activities.findMany({
        where: { id: outOfGateId },
      });
      expect(outOfGateRows).toHaveLength(0);
    });

    it('req 2.5 — action group / essential composition is unchanged: essential actions are always in the available set, regardless of app:auditLogEnabled', async () => {
      await configManager.updateConfigs({ 'app:auditLogEnabled': false });
      const availableWhenDisabled = crowi.activityService.getAvailableActions();
      expect(availableWhenDisabled).toEqual(AllEssentialActions);

      await configManager.updateConfigs({
        'app:auditLogEnabled': true,
        'app:auditLogActionGroupSize': ActionGroupSize.Small,
      });
      const availableWhenEnabled = crowi.activityService.getAvailableActions();
      for (const essentialAction of AllEssentialActions) {
        expect(availableWhenEnabled).toContain(essentialAction);
      }
    });
  });

  // ---------------------------------------------------------------------
  // 7.5 — 'updated' event propagation to real listeners (no mocked emit).
  // in-app-notification.ts's activityEvent.on('updated', ...) listener reads
  // `target` and `preNotify` off this event to build notifications, so this
  // contract needs its own coverage (previously exercised by the now-removed
  // "'update' event handling" block in service/activity.integ.ts, retired
  // because it pre-dated the lazy-fail-safe settle design).
  // ---------------------------------------------------------------------
  describe("7.5 — 'updated' event propagation (real listener, no mocked emit)", () => {
    it("emits 'updated' with the settled activity, target, and the preNotify built by generatePreNotify", async () => {
      const context = buildContext(testUserId.toHexString());
      const { activityId } = beginActivity(context);
      const target = new Types.ObjectId();
      const preNotifySentinel = vi.fn();
      const generatePreNotify = vi.fn().mockReturnValue(preNotifySentinel);

      const updatedListener = vi.fn();
      crowi.events.activity.once('updated', updatedListener);

      crowi.events.activity.emit(
        'update',
        activityId,
        { action: SupportedAction.ACTION_PAGE_EMPTY_TRASH },
        target,
        generatePreNotify,
      );

      await vi.waitFor(() => expect(updatedListener).toHaveBeenCalled());

      // generatePreNotify must receive the settled (persisted) activity, not
      // the pre-settle parameters -- this is what real 'updated' subscribers
      // rely on. Only checking the first arg here (not the full call
      // signature): whether a caller omits an absent getAdditionalTargetUsers
      // or passes it as explicit `undefined` is not part of the contract.
      expect(generatePreNotify.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({ _id: activityId }),
      );
      expect(updatedListener).toHaveBeenCalledWith(
        expect.objectContaining({ _id: activityId }),
        target,
        preNotifySentinel,
      );
    });

    it("emits 'updated' with just the activity and target (no preNotify arg) when generatePreNotify is not provided", async () => {
      const context = buildContext(testUserId.toHexString());
      const { activityId } = beginActivity(context);
      const target = new Types.ObjectId();

      const updatedListener = vi.fn();
      crowi.events.activity.once('updated', updatedListener);

      crowi.events.activity.emit(
        'update',
        activityId,
        { action: SupportedAction.ACTION_PAGE_EMPTY_TRASH },
        target,
      );

      await vi.waitFor(() => expect(updatedListener).toHaveBeenCalled());

      expect(updatedListener).toHaveBeenCalledWith(
        expect.objectContaining({ _id: activityId }),
        target,
      );
    });

    it("does not emit 'updated' for an out-of-gate action that never settles a row", async () => {
      const outContext = buildContext(testUserId.toHexString());
      const { activityId: outOfGateId } = beginActivity(outContext);
      const updatedListener = vi.fn();
      crowi.events.activity.on('updated', updatedListener);

      crowi.events.activity.emit('update', outOfGateId, {
        action: SupportedAction.ACTION_ADMIN_APP_SETTINGS_UPDATE, // Large-only, not essential
      });

      // Causal-ordering proof of absence (see file header): wait for an
      // in-gate companion's real settle before asserting the negative.
      const companionContext = buildContext(testUserId.toHexString());
      const { activityId: companionId } = beginActivity(companionContext);
      crowi.events.activity.emit('update', companionId, {
        action: SupportedAction.ACTION_PAGE_EMPTY_TRASH,
      });
      await waitForActivityRows({ id: companionId });

      crowi.events.activity.off('updated', updatedListener);
      const calledForOutOfGate = updatedListener.mock.calls.some(
        (args) => (args[0] as { _id?: string })?._id === outOfGateId,
      );
      expect(calledForOutOfGate).toBe(false);
    });
  });
});
