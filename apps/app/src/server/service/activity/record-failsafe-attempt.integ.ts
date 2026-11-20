/**
 * Integration tests — recordFailsafeAttempt (real DB, replica set rs0).
 *
 * Contract under test (design.md: Service / fail-safe > recordFailsafeAttempt;
 * tasks.md Task 3.1): given a pre-minted activity id and the request-time
 * context, create exactly ONE ACTION_UNSETTLED row carrying the operator,
 * operator name, ip, endpoint, and arrival-time createdAt (req 4.1, 4.3). If
 * settle has ALREADY created the real-action row under the same pre-minted id
 * (the primary key), the duplicate-key error from `create` must be swallowed
 * as benign — no second row, the real-action row stays intact, and the
 * function must not throw (req 4.2 — no double-create).
 *
 * No pre-read: this suite never calls `findFirst` before `recordFailsafeAttempt`
 * to check for an existing row (design.md: Issue 1 — duplicate-key absorption
 * replaces an existence check, not stacks on top of one). Every assertion
 * reads the row back from the real DB independently of the function's return
 * value.
 *
 * Requires a real MongoDB connection (wired by vitest.workspace.mts integ
 * setup; per-worker DB isolation via test/setup/mongo + test/setup/prisma).
 *
 * Requirements: 4.1, 4.2, 4.3
 * Design: Service / fail-safe > recordFailsafeAttempt, Error Handling
 *   (二重作成の競合（稀）)
 */

import { Types } from 'mongoose';

import { SupportedAction } from '~/interfaces/activity';
import { prisma } from '~/utils/prisma';

import type { PendingActivityContext } from './pending-activity-context';
import { recordFailsafeAttempt } from './record-failsafe-attempt';

// Sentinel ip so cleanup deletes only this suite's rows.
const TEST_IP = '10.0.0.87';
const TEST_ENDPOINT = '/test/record-failsafe-attempt';

function buildContext(
  overrides: Partial<PendingActivityContext> = {},
): PendingActivityContext {
  return {
    ip: TEST_IP,
    endpoint: TEST_ENDPOINT,
    userId: new Types.ObjectId().toHexString(),
    username: 'failsafe_operator',
    // Arrival time distinct from "now" so the assertion cannot pass by
    // coincidence with the finalizer's own clock (Issue 3 precedent).
    createdAt: new Date(Date.now() - 60_000),
    ...overrides,
  };
}

describe('recordFailsafeAttempt (real DB)', () => {
  beforeEach(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  it('req 4.1/4.3 — creates exactly one ACTION_UNSETTLED row for an unpersisted id, carrying operator/operator-name/ip/endpoint/arrival-time', async () => {
    const activityId = new Types.ObjectId().toString();
    const context = buildContext();

    await recordFailsafeAttempt(activityId, context);

    // Read back from the real DB independently of any return value.
    const rows = await prisma.activities.findMany({
      where: { id: activityId },
    });

    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.action).toBe(SupportedAction.ACTION_UNSETTLED);
    expect(row.userId).toBe(context.userId);
    expect(row.snapshot.username).toBe(context.username);
    expect(row.ip).toBe(context.ip);
    expect(row.endpoint).toBe(context.endpoint);
    expect(row.createdAt.getTime()).toBe(context.createdAt.getTime());
  });

  it('req 4.2 — swallows the duplicate-key error and does not create a second row when settle already created the real-action row for this id', async () => {
    const activityId = new Types.ObjectId().toString();
    const context = buildContext();

    // Simulate settle having already created the REAL-action row under the
    // SAME pre-minted id (the rare race the design accepts: emit already
    // happened, settle is in-flight, and the request also ends in failure).
    await prisma.activities.createByParameters({
      id: activityId,
      action: SupportedAction.ACTION_PAGE_UPDATE,
      ip: context.ip,
      endpoint: context.endpoint,
      createdAt: context.createdAt,
      user: context.userId,
      snapshot: { username: context.username },
    });

    // Act: the finalizer still fires (request ended in failure) and calls
    // recordFailsafeAttempt for the same id. It must not throw.
    await expect(
      recordFailsafeAttempt(activityId, context),
    ).resolves.toBeUndefined();

    // Assert: still exactly one row, and it is still the REAL action --
    // recordFailsafeAttempt must not have overwritten or duplicated it.
    const rows = await prisma.activities.findMany({
      where: { id: activityId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe(SupportedAction.ACTION_PAGE_UPDATE);
  });
});
