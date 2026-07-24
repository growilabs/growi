/**
 * Integration test — executeImport must settle ACTION_ADMIN_GROWI_DATA_IMPORTED
 * with the operator, even though it runs AFTER the HTTP response.
 *
 * `POST /_api/v3/import` responds immediately (progress streams over WebSocket)
 * and only then awaits the import and emits its audit activity. By that time
 * `registerFailsafeFinalizer` has cleared this request's entry from
 * `pendingActivityContext` on the response's 'finish' event, so a naive emit
 * would settle the row with `user: null` -- the same root cause as the
 * notification-list crash (PR #11510), surfacing here as an audit-log row with
 * an unknown operator. The route captures the context before responding and
 * hands it to executeImport, which re-arms it right before the emit.
 *
 * This test reproduces the post-'finish' state faithfully: the captured context
 * is NOT present in `pendingActivityContext` when executeImport runs (mimicking
 * the finalizer having already cleared it). Only the re-arm inside executeImport
 * lets the real ActivityService listener settle the row with the operator.
 *
 * Path under test (real, unmocked emit/listener/settle/prisma): executeImport ->
 * pendingActivityContext.set (re-arm) -> crowi.events.activity.emit('update') ->
 * the REAL ActivityService listener -> pendingActivityContext.take ->
 * settleActivityRecord -> prisma.activities.createByParameters. Only
 * ImportService.import is stubbed.
 *
 * Requires a real MongoDB (wired by vitest.workspace.mts integ setup).
 */

import { EventEmitter } from 'node:events';
import type { IUserHasId } from '@growi/core';
import { Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { ActionGroupSize, SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import type { PendingActivityContext } from '~/server/service/activity/index';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import { executeImport } from './import-executor';

const TEST_IP = '10.0.0.113';
const TEST_ENDPOINT = '/_api/v3/import';
const TEST_USERNAME = 'import-executor-integ-user';

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

describe('executeImport — settles the import activity with the operator captured before the response (PR #11510)', () => {
  let crowi: Crowi;
  let testUser: IUserHasId;
  let testUserId: Types.ObjectId;

  beforeAll(async () => {
    crowi = await getInstance();

    testUser = await crowi.models.User.create({
      name: 'Import Executor Integ User',
      username: TEST_USERNAME,
      email: 'import-executor-integ@example.com',
    });
    testUserId = new Types.ObjectId(testUser._id);
  }, 120_000);

  beforeEach(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });

    // ACTION_ADMIN_GROWI_DATA_IMPORTED must be in-gate so the row is persisted.
    await configManager.updateConfigs({
      'app:auditLogEnabled': true,
      'app:auditLogActionGroupSize': ActionGroupSize.Large,
    });
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

  it('records the operator when the pending context has already been cleared (post-response state)', async () => {
    const activityId = new Types.ObjectId().toString();

    // The context the add-activity middleware built at request arrival, which
    // the route captured before responding. It is deliberately NOT put back
    // into pendingActivityContext here: that mirrors the finalizer having
    // cleared it on 'finish' before the (post-response) import runs.
    const activityContext: PendingActivityContext = {
      ip: TEST_IP,
      endpoint: TEST_ENDPOINT,
      userId: testUserId.toHexString(),
      username: TEST_USERNAME,
      createdAt: new Date(),
    };

    const importService = { import: vi.fn().mockResolvedValue(undefined) };
    const adminEvent = new EventEmitter();

    await executeImport({
      importService,
      adminEvent,
      activityEvent: crowi.events.activity,
      activityId,
      activityContext,
      collections: [],
      importSettingsMap: new Map(),
    });

    const rows = await waitForActivityRows({ id: activityId });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe(
      SupportedAction.ACTION_ADMIN_GROWI_DATA_IMPORTED,
    );
    expect(rows[0].userId).toBe(testUserId.toHexString());
    // The ip/endpoint also come from the captured context, confirming the whole
    // context (not just userId) survives the response boundary.
    expect(rows[0].ip).toBe(TEST_IP);
  });
});
