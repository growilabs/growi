/**
 * Integration tests — audit-log export cursor: order and resume semantics (req 3.3).
 *
 * `exportActivityCursor` is the async generator that streams all activities
 * matching a filter in ascending `id` (_id) order, one batch at a time, using
 * Prisma `findMany` with `id: { gt: lastId }` to resume.  These tests seed
 * activities via `prisma.activities.createMany` (explicit `_id` ObjectId strings —
 * research R4) into the same per-worker test DB, then assert the observable
 * contracts:
 *
 *   - All matching activities are yielded in ascending `_id` order (req 3.3 order).
 *   - Batching: the cursor yields every record exactly once, even when batchSize
 *     is smaller than the total count (correctness across multiple fetch rounds).
 *   - Resume / `startAfterId`: passing a `lastExportedId` correctly skips records
 *     up to and including that id, yielding only what follows — no skips or dups
 *     (req 3.3 resume semantics).
 *   - The `where` base filter is respected: records not matching the filter are
 *     not included even when interspersed with matching records.
 *
 * Requires a real MongoDB connection (wired by vitest.workspace.mts integ setup).
 * These tests CANNOT run locally (no mongod binary / egress 403).
 * The local bar is: type-checks cleanly; CI (external MONGO_URI) exercises actual DB.
 *
 * Requirements: 3.3
 * Design: activity-export-cursor executor; "CSV エクスポートの cursor バッチング (確定3)";
 *   "_id 昇順・id>lastExportedId で再開可能 … 現行 find().cursor() と同一順序 (要件 3.3)".
 */

import { Types } from 'mongoose';

import { ActivityLogActions } from '~/interfaces/activity';
import { prisma } from '~/utils/prisma';

import {
  type ActivityCursorWhere,
  exportActivityCursor,
} from './activity-export-cursor';

// A sentinel ip value so cleanup deletes only this suite's rows.
const TEST_IP = '10.0.0.71';

// Monotonically-increasing offset so records seeded in the same tight loop
// (same userId/target/action, no explicit createdAt) get distinct
// createdAt values -- otherwise same-millisecond createdAt collides with
// the compound unique index (userId, target, action, createdAt).
let createdAtOffsetMs = 0;

/** Build a minimal activities record for seeding via prisma.activities.createMany. */
function makeActivityData(overrides: {
  id: string;
  userId: string;
  action: string;
  createdAt?: Date;
  ip?: string;
}) {
  return {
    id: overrides.id,
    v: 0,
    action: overrides.action,
    createdAt:
      overrides.createdAt ?? new Date(Date.now() + createdAtOffsetMs++),
    endpoint: '/test/export-cursor',
    ip: overrides.ip ?? TEST_IP,
    snapshot: { id: new Types.ObjectId().toHexString(), username: 'testuser' },
    userId: overrides.userId,
  };
}

/**
 * Collect all values from an AsyncIterable into an array.
 * This is how exportAuditLogsToFsAsync consumes the cursor.
 */
async function collectAll<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of iterable) {
    results.push(item);
  }
  return results;
}

describe('exportActivityCursor', () => {
  beforeEach(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  it('req 3.3 — yields all matching activities in ascending _id order', async () => {
    // Arrange: seed 5 activities with known ObjectId hex strings.
    // ObjectId hex strings sort lexicographically in the same order as ObjectId
    // byte-order (monotonically increasing when generated in sequence).
    const userId = new Types.ObjectId().toHexString();
    const ids = Array.from({ length: 5 }, () =>
      new Types.ObjectId().toHexString(),
    ).sort(); // Ensure predictable ascending order for comparison

    await prisma.activities.createMany({
      data: ids.map((id) =>
        makeActivityData({
          id,
          userId,
          action: ActivityLogActions.ACTION_PAGE_CREATE,
        }),
      ),
    });

    const where: ActivityCursorWhere = { ip: TEST_IP };

    // Act: collect all yielded docs with a batchSize of 2 (forces multiple rounds)
    const collected = await collectAll(exportActivityCursor(prisma, where, 2));

    // Assert: every seeded id is present, in ascending id order, no duplicates
    const collectedIds = collected.map((doc) => doc.id);

    expect(collectedIds).toHaveLength(5);
    // Sorted ascending order matches the cursor's orderBy: { id: 'asc' }
    expect(collectedIds).toEqual([...collectedIds].sort());
    // All seeded IDs are present (no skips across batches)
    for (const id of ids) {
      expect(collectedIds).toContain(id);
    }
  });

  it('req 3.3 — batchSize smaller than total: all docs are yielded exactly once', async () => {
    // Arrange: seed 7 activities; use batchSize=3 to force 3 findMany calls
    const userId = new Types.ObjectId().toHexString();

    await prisma.activities.createMany({
      data: Array.from({ length: 7 }, () =>
        makeActivityData({
          id: new Types.ObjectId().toHexString(),
          userId,
          action: ActivityLogActions.ACTION_PAGE_UPDATE,
        }),
      ),
    });

    const where: ActivityCursorWhere = { ip: TEST_IP };

    // Act
    const collected = await collectAll(exportActivityCursor(prisma, where, 3));
    const collectedIds = collected.map((doc) => doc.id);

    // Assert: all 7 seeded docs, no duplicates
    expect(collectedIds).toHaveLength(7);
    expect(new Set(collectedIds).size).toBe(7);
  });

  it('req 3.3 — resume via startAfterId: continues from lastExportedId without skips or dups', async () => {
    // Arrange: seed 6 activities with stable, sortable IDs
    const userId = new Types.ObjectId().toHexString();
    // Generate IDs and sort them to know the exact ascending order
    const ids = Array.from({ length: 6 }, () =>
      new Types.ObjectId().toHexString(),
    ).sort();

    await prisma.activities.createMany({
      data: ids.map((id) =>
        makeActivityData({
          id,
          userId,
          action: ActivityLogActions.ACTION_PAGE_CREATE,
        }),
      ),
    });

    // Simulate: first export run consumed the first 3 docs (ids[0..2])
    const lastExportedId = ids[2];

    const where: ActivityCursorWhere = { ip: TEST_IP };

    // Act: resume from lastExportedId — should yield ids[3], ids[4], ids[5]
    const resumed = await collectAll(
      exportActivityCursor(prisma, where, 10, lastExportedId),
    );
    const resumedIds = resumed.map((doc) => doc.id);

    // Assert: exactly the 3 remaining records, in ascending order
    expect(resumedIds).toHaveLength(3);
    expect(resumedIds).toEqual([ids[3], ids[4], ids[5]]);
  });

  it('req 3.3 — where filter excludes non-matching activities', async () => {
    // Arrange: seed activities with two different actions, filter to just one
    const userId = new Types.ObjectId().toHexString();

    await prisma.activities.createMany({
      data: [
        makeActivityData({
          id: new Types.ObjectId().toHexString(),
          userId,
          action: ActivityLogActions.ACTION_PAGE_CREATE,
        }),
        makeActivityData({
          id: new Types.ObjectId().toHexString(),
          userId,
          action: ActivityLogActions.ACTION_PAGE_UPDATE,
        }),
        makeActivityData({
          id: new Types.ObjectId().toHexString(),
          userId,
          action: ActivityLogActions.ACTION_PAGE_CREATE,
        }),
      ],
    });

    // Filter: only PAGE_CREATE activities from our sentinel IP
    const where: ActivityCursorWhere = {
      ip: TEST_IP,
      action: ActivityLogActions.ACTION_PAGE_CREATE,
    };

    // Act
    const collected = await collectAll(exportActivityCursor(prisma, where, 10));

    // Assert: only the 2 PAGE_CREATE activities are yielded
    expect(collected).toHaveLength(2);
    for (const doc of collected) {
      expect(doc.action).toBe(ActivityLogActions.ACTION_PAGE_CREATE);
    }
  });

  it('req 3.3 — yields nothing when no activities match the filter', async () => {
    // Arrange: no activities seeded for this user
    const userId = new Types.ObjectId().toHexString();
    const where: ActivityCursorWhere = {
      ip: TEST_IP,
      userId,
    };

    // Act
    const collected = await collectAll(exportActivityCursor(prisma, where, 10));

    // Assert: empty iterable, no throw
    expect(collected).toHaveLength(0);
  });
});
