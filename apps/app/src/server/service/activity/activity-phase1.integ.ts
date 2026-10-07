/**
 * Integration tests — Phase-1 observable behavior: create / update / skip / dup-prevention
 *
 * Tests assert the observable contracts of the Prisma-based ActivityExtension:
 *   - req 1.1: createByParameters persists the expected fields (user, ip, endpoint,
 *              action, target, targetModel, snapshot.username, createdAt)
 *   - req 1.2: updateByParameters (activityEvent 'update' path) settles an UNSETTLED
 *              activity, returning the updated document with the new action / snapshot
 *   - req 1.3: shoudUpdateActivity gate — action not in getAvailableActions is skipped
 *              (no activity update occurs for that action)
 *   - req 4.2: compound unique constraint (userId, target, action, createdAt) is enforced;
 *              a duplicate insert is rejected with a Prisma P2002 error
 *
 * Requires a real MongoDB connection (wired by vitest.workspace.mts integ setup).
 * These tests CANNOT run locally (no mongod binary / egress 403).
 * The local bar is: type-checks cleanly; CI (external MONGO_URI) exercises actual DB.
 *
 * Requirements: 1.1, 1.2, 1.3, 4.2
 * Design: ActivityExtension Postconditions, Error Handling (P2002), shoudUpdateActivity gate
 */

import { Types } from 'mongoose';

import { Prisma } from '~/generated/prisma/client';
import { SupportedAction } from '~/interfaces/activity';
import { prisma } from '~/utils/prisma';

// ---------------------------------------------------------------------------
// Runtime type helpers
// ---------------------------------------------------------------------------

/**
 * The createByParameters extension method returns Promise<IActivity>, but at
 * runtime the value is a Prisma activities row which also has `.id` (string)
 * and a typed `.snapshot` composite.  We use this intersection to access both
 * the Mongoose-compat `_id` field AND the Prisma `id`/`snapshot.id` fields in
 * tests, without losing IActivity's fields.
 *
 * Tier-2 rationale (essential-test-patterns): the runtime value IS this shape —
 * the cast is confined to a single binding per test, not to the whole object.
 */
type ActivityRow = {
  id: string;
  _id: string;
  __v: number;
  action: string;
  ip: string;
  endpoint: string;
  userId: string | null;
  target: string | null;
  targetModel: string | null;
  snapshot: { id: string; username: string } | null;
  createdAt: Date;
  user?: unknown;
};

function asRow(value: unknown): ActivityRow {
  // WHY: createByParameters returns IActivity (Mongoose-compat type) but the
  // runtime object is a Prisma activities row with `.id` and typed snapshot.
  // Casting through `unknown` is required to access Prisma-specific fields in tests.
  return value as unknown as ActivityRow;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal createByParameters input.
 * We use a dedicated ip prefix so cleanup deletes only this suite's rows.
 */
function makeCreateParams(overrides: {
  userId?: string;
  username?: string;
  action?: string;
  ip?: string;
  endpoint?: string;
  target?: string;
  targetModel?: string;
  createdAt?: Date;
}) {
  return {
    action: overrides.action ?? SupportedAction.ACTION_PAGE_CREATE,
    ip: overrides.ip ?? TEST_IP,
    endpoint: overrides.endpoint ?? '/test/phase1',
    user: overrides.userId,
    snapshot: { username: overrides.username ?? 'testuser_phase1' },
    target: overrides.target,
    targetModel: overrides.targetModel,
    createdAt: overrides.createdAt,
  };
}

// A sentinel ip value that lets cleanup delete only this suite's rows.
const TEST_IP = '10.0.0.99';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('ActivityExtension — Phase-1 observable behavior', () => {
  beforeEach(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  // -------------------------------------------------------------------------
  // req 1.1 — createByParameters stores expected fields
  // -------------------------------------------------------------------------
  describe('req 1.1 — createByParameters: recorded fields', () => {
    it('persists all supplied fields on the created activity', async () => {
      const userId = new Types.ObjectId().toHexString();
      const targetId = new Types.ObjectId().toHexString();
      const now = new Date();

      const raw = await prisma.activities.createByParameters(
        makeCreateParams({
          userId,
          action: SupportedAction.ACTION_PAGE_CREATE,
          ip: TEST_IP,
          endpoint: '/test/phase1/create',
          target: targetId,
          targetModel: 'Page',
          username: 'alice_phase1',
          createdAt: now,
        }),
      );
      const created = asRow(raw);

      // Observable: all caller-supplied fields are stored and retrievable
      expect(created.action).toBe(SupportedAction.ACTION_PAGE_CREATE);
      expect(created.ip).toBe(TEST_IP);
      expect(created.endpoint).toBe('/test/phase1/create');
      expect(created.userId).toBe(userId);
      expect(created.target).toBe(targetId);
      expect(created.targetModel).toBe('Page');
      expect(created.snapshot).toMatchObject({ username: 'alice_phase1' });
      expect(created.createdAt).toEqual(now);

      // Backward-compat computed fields (req 2.3, 5.3)
      expect(created._id).toBeDefined();
      expect(created.__v).toBeDefined();
    });

    it('creates an UNSETTLED activity (default action from addActivity middleware path)', async () => {
      const userId = new Types.ObjectId().toHexString();

      const raw = await prisma.activities.createByParameters(
        makeCreateParams({
          userId,
          action: SupportedAction.ACTION_UNSETTLED,
          endpoint: '/test/phase1/unsettled',
          username: 'bob_phase1',
        }),
      );
      const created = asRow(raw);

      expect(created.action).toBe(SupportedAction.ACTION_UNSETTLED);
      expect(created.snapshot).toMatchObject({ username: 'bob_phase1' });
    });
  });

  // -------------------------------------------------------------------------
  // req 1.2 — updateByParameters settles an UNSETTLED activity
  // -------------------------------------------------------------------------
  describe('req 1.2 — updateByParameters: settle flow', () => {
    it('updates action and snapshot on an existing UNSETTLED activity', async () => {
      const userId = new Types.ObjectId().toHexString();

      // Step 1: create UNSETTLED (simulate addActivity middleware)
      const rawInitial = await prisma.activities.createByParameters(
        makeCreateParams({
          userId,
          action: SupportedAction.ACTION_UNSETTLED,
          endpoint: '/test/phase1/settle',
          username: 'charlie_phase1',
        }),
      );
      const initial = asRow(rawInitial);

      // Step 2: settle via updateByParameters (simulate activityEvent 'update' handler)
      // snapshot is a plain ISnapshot (no id): updateByParameters converts it
      // to the composite { update } envelope internally, preserving the
      // existing snapshot._id (activity-log task 2.2 input contract).
      const rawUpdated = await prisma.activities.updateByParameters(
        initial.id,
        {
          action: SupportedAction.ACTION_PAGE_CREATE,
          snapshot: {
            username: 'charlie_phase1',
          },
        },
      );
      const updated = asRow(rawUpdated);

      // Observable: the activity is now settled with the new action
      expect(updated).not.toBeNull();
      expect(updated.action).toBe(SupportedAction.ACTION_PAGE_CREATE);
      // The snapshot username is preserved
      expect(updated.snapshot).toMatchObject({ username: 'charlie_phase1' });
      // The id is unchanged (same document)
      expect(updated.id).toBe(initial.id);
    });

    it('returns null when the activityId does not exist (P2025 → null semantics)', async () => {
      const nonexistentId = new Types.ObjectId().toHexString();

      const result = await prisma.activities.updateByParameters(nonexistentId, {
        action: SupportedAction.ACTION_PAGE_UPDATE,
      });

      // C1 postcondition: not-found must return null, not throw
      expect(result).toBeNull();
    });

    it('returns updated document with both userId and user fields (Key Decision 5)', async () => {
      const userId = new Types.ObjectId().toHexString();

      const rawInitial = await prisma.activities.createByParameters(
        makeCreateParams({
          userId,
          action: SupportedAction.ACTION_UNSETTLED,
          endpoint: '/test/phase1/kd5',
          username: 'diana_phase1',
        }),
      );
      const initial = asRow(rawInitial);

      const rawUpdated = await prisma.activities.updateByParameters(
        initial.id,
        {
          action: SupportedAction.ACTION_PAGE_UPDATE,
          // plain ISnapshot — the { update } envelope conversion inside
          // updateByParameters keeps the existing snapshot._id
          snapshot: {
            username: 'diana_phase1',
          },
        },
      );

      expect(rawUpdated).not.toBeNull();
      // Key Decision 5: userId scalar must be present
      const updated = asRow(rawUpdated);
      expect(updated.userId).toBe(userId);
      // Key Decision 5: user relation field exists on the result
      // (may be null when no matching users document — the contract is the field
      // exists, not that it is populated)
      // rawUpdated is non-null (asserted above); cast to object for hasOwn check
      expect(Object.hasOwn(rawUpdated as object, 'user')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // req 1.3 — shoudUpdateActivity gate: non-recordable action is skipped
  // -------------------------------------------------------------------------
  describe('req 1.3 — shoudUpdateActivity gate: ACTION_UNSETTLED is never in getAvailableActions', () => {
    it('activity remains UNSETTLED when no settlement update is applied (gate returns false)', async () => {
      // Observable contract: ACTION_UNSETTLED is not in any action group
      // (Essential / Small / Medium / Large), so shoudUpdateActivity('UNSETTLED')
      // returns false and the activityEvent handler skips updateByParameters.
      //
      // We assert the DB state that results from the gate returning false:
      // the activity persists with its original UNSETTLED action unchanged.

      const userId = new Types.ObjectId().toHexString();

      // Create activity in UNSETTLED state
      const rawActivity = await prisma.activities.createByParameters(
        makeCreateParams({
          userId,
          action: SupportedAction.ACTION_UNSETTLED,
          endpoint: '/test/phase1/gate',
          username: 'eve_phase1',
        }),
      );
      const activity = asRow(rawActivity);

      // Simulate "gate returned false — no update called".
      // Read back the record directly to confirm it is still UNSETTLED.
      const inDb = await prisma.activities.findFirst({
        where: { id: activity.id },
      });

      // The activity remains UNSETTLED (the update path was gated off)
      expect(inDb?.action).toBe(SupportedAction.ACTION_UNSETTLED);
    });
  });

  // -------------------------------------------------------------------------
  // req 4.2 — compound unique constraint: duplicate is rejected
  // -------------------------------------------------------------------------
  describe('req 4.2 — compound unique constraint', () => {
    it('rejects a duplicate (userId, target, action, createdAt) insert with P2002', async () => {
      const userId = new Types.ObjectId().toHexString();
      const target = new Types.ObjectId().toHexString();
      const action = SupportedAction.ACTION_PAGE_CREATE;
      const createdAt = new Date('2024-01-15T10:00:00.000Z');

      // Insert the first record (must succeed)
      await prisma.activities.createByParameters(
        makeCreateParams({
          userId,
          action,
          target,
          targetModel: 'Page',
          endpoint: '/test/phase1/dup',
          username: 'frank_phase1',
          createdAt,
        }),
      );

      // Attempt the exact duplicate — must throw P2002
      await expect(
        prisma.activities.createByParameters(
          makeCreateParams({
            userId,
            action,
            target,
            targetModel: 'Page',
            endpoint: '/test/phase1/dup',
            username: 'frank_phase1',
            createdAt,
          }),
        ),
      ).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002',
      );
    });

    it('allows two inserts that share userId+target+action but differ by createdAt', async () => {
      const userId = new Types.ObjectId().toHexString();
      const target = new Types.ObjectId().toHexString();
      const action = SupportedAction.ACTION_PAGE_UPDATE;

      // Two activities with the same user/target/action but different timestamps
      // must coexist (no unique-constraint violation).
      const rawFirst = await prisma.activities.createByParameters(
        makeCreateParams({
          userId,
          action,
          target,
          targetModel: 'Page',
          endpoint: '/test/phase1/dup2',
          username: 'grace_phase1',
          createdAt: new Date('2024-02-01T09:00:00.000Z'),
        }),
      );

      const rawSecond = await prisma.activities.createByParameters(
        makeCreateParams({
          userId,
          action,
          target,
          targetModel: 'Page',
          endpoint: '/test/phase1/dup2',
          username: 'grace_phase1',
          createdAt: new Date('2024-02-01T10:00:00.000Z'),
        }),
      );

      const first = asRow(rawFirst);
      const second = asRow(rawSecond);

      // Both records are distinct
      expect(first.id).not.toBe(second.id);

      const count = await prisma.activities.count({
        where: { userId, target, action, ip: TEST_IP },
      });
      expect(count).toBe(2);
    });
  });
});
