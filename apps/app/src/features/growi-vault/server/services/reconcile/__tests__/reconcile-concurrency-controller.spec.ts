/**
 * reconcile-concurrency-controller.spec.ts
 *
 * Unit tests for ConcurrencyController.
 *
 * Requirements: 6.6, 6.7
 * Design: Components and Interfaces > ConcurrencyController
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { ConcurrencyController } from '../reconcile-concurrency-controller';
import { createConcurrencyController } from '../reconcile-concurrency-controller';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a Promise that resolves after all pending microtasks have been
 * drained. Because tryRunInBackground schedules work via
 * Promise.resolve().then(...), awaiting this helper ensures the work callback
 * (and its finally block) have completed before assertions are made.
 */
async function flushMicrotasks(): Promise<void> {
  // A single Promise.resolve() is sufficient for the microtask queue depth
  // used by tryRunInBackground (one .then level).  Awaiting it twice gives
  // a comfortable margin in case the work itself schedules additional ticks.
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

const BASE_CONFIG = {
  maxConcurrentPerUser: 1,
  maxConcurrentSystem: 3,
  adminBypassCapacityLimit: false,
} as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConcurrencyController', () => {
  let controller: ConcurrencyController;

  beforeEach(() => {
    controller = createConcurrencyController(BASE_CONFIG);
  });

  // -------------------------------------------------------------------------
  // 1. Happy path — slot acquired, work scheduled
  // -------------------------------------------------------------------------

  describe('tryRunInBackground — ok path', () => {
    it('returns { ok: true } when a slot is available', () => {
      const result = controller.tryRunInBackground({
        userId: 'user-1',
        isAdmin: false,
        work: async () => {},
      });

      expect(result.ok).toBe(true);
    });

    it('increments system-wide active count after acquiring a slot', () => {
      const work = (): Promise<void> =>
        new Promise(() => {
          /* never resolves — holds the slot */
        });

      controller.tryRunInBackground({ userId: 'user-1', isAdmin: false, work });
      expect(controller.getActiveCount()).toBe(1);
    });

    it('increments per-user active count after acquiring a slot', () => {
      const work = (): Promise<void> =>
        new Promise(() => {
          /* never resolves */
        });

      controller.tryRunInBackground({ userId: 'user-1', isAdmin: false, work });
      expect(controller.getActiveCount({ userId: 'user-1' })).toBe(1);
    });

    it('decrements counters to 0 after work resolves', async () => {
      // Use a deferred pattern: store the resolve handle in a Promise that
      // resolves once the work function is invoked (i.e., after the microtask).
      let resolveWork!: () => void;
      const workCalled = new Promise<void>((outer) => {
        const work = (): Promise<void> =>
          new Promise<void>((inner) => {
            resolveWork = inner;
            outer(); // signal that work has been invoked
          });

        controller.tryRunInBackground({
          userId: 'user-1',
          isAdmin: false,
          work,
        });
      });

      expect(controller.getActiveCount()).toBe(1);

      // Wait until work() has actually been called by the microtask
      await workCalled;

      resolveWork();
      await flushMicrotasks();

      expect(controller.getActiveCount()).toBe(0);
      expect(controller.getActiveCount({ userId: 'user-1' })).toBe(0);
    });

    it('returns synchronously (does not await work)', () => {
      let workStarted = false;
      const work = (): Promise<void> => {
        workStarted = true;
        return Promise.resolve();
      };

      // tryRunInBackground must return before work actually starts
      const result = controller.tryRunInBackground({
        userId: 'user-1',
        isAdmin: false,
        work,
      });

      expect(result.ok).toBe(true);
      // work is scheduled as a microtask, not started synchronously
      expect(workStarted).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Per-user concurrency limit (default 1)
  // -------------------------------------------------------------------------

  describe('tryRunInBackground — user-concurrency-limit path', () => {
    it('rejects a second request from the same user when per-user limit is reached', () => {
      const holdingWork = (): Promise<void> =>
        new Promise(() => {
          /* never resolves */
        });

      // First request — should succeed
      const first = controller.tryRunInBackground({
        userId: 'user-1',
        isAdmin: false,
        work: holdingWork,
      });
      expect(first.ok).toBe(true);

      // Second request from same user — should be rejected
      const second = controller.tryRunInBackground({
        userId: 'user-1',
        isAdmin: false,
        work: holdingWork,
      });
      expect(second.ok).toBe(false);
      if (!second.ok) {
        expect(second.reason).toBe('user-concurrency-limit');
      }
    });

    it('does not affect a different user when per-user limit is reached for one user', () => {
      const holdingWork = (): Promise<void> =>
        new Promise(() => {
          /* never resolves */
        });

      // Fill user-1's slot
      controller.tryRunInBackground({
        userId: 'user-1',
        isAdmin: false,
        work: holdingWork,
      });

      // user-2 should still get a slot
      const result = controller.tryRunInBackground({
        userId: 'user-2',
        isAdmin: false,
        work: holdingWork,
      });
      expect(result.ok).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 3. System-wide concurrency limit (default 3)
  // -------------------------------------------------------------------------

  describe('tryRunInBackground — system-concurrency-limit path', () => {
    it('rejects a new request when system-wide limit is reached (3 concurrent)', () => {
      const holdingWork = (): Promise<void> =>
        new Promise(() => {
          /* never resolves */
        });

      // Use 3 distinct users to avoid per-user limit
      controller.tryRunInBackground({
        userId: 'user-1',
        isAdmin: false,
        work: holdingWork,
      });
      controller.tryRunInBackground({
        userId: 'user-2',
        isAdmin: false,
        work: holdingWork,
      });
      controller.tryRunInBackground({
        userId: 'user-3',
        isAdmin: false,
        work: holdingWork,
      });

      expect(controller.getActiveCount()).toBe(3);

      const fourth = controller.tryRunInBackground({
        userId: 'user-4',
        isAdmin: false,
        work: holdingWork,
      });
      expect(fourth.ok).toBe(false);
      if (!fourth.ok) {
        expect(fourth.reason).toBe('system-concurrency-limit');
      }
    });

    it('system-wide counter does not exceed maxConcurrentSystem', () => {
      const holdingWork = (): Promise<void> =>
        new Promise(() => {
          /* never resolves */
        });

      for (let i = 0; i < 5; i++) {
        controller.tryRunInBackground({
          userId: `user-${i}`,
          isAdmin: false,
          work: holdingWork,
        });
      }

      expect(controller.getActiveCount()).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Admin bypass
  // -------------------------------------------------------------------------

  describe('admin bypass', () => {
    it('admin with adminBypassCapacityLimit=true can exceed system-wide limit', () => {
      const bypassController = createConcurrencyController({
        ...BASE_CONFIG,
        adminBypassCapacityLimit: true,
      });

      const holdingWork = (): Promise<void> =>
        new Promise(() => {
          /* never resolves */
        });

      // Fill system slots with non-admin users
      bypassController.tryRunInBackground({
        userId: 'user-1',
        isAdmin: false,
        work: holdingWork,
      });
      bypassController.tryRunInBackground({
        userId: 'user-2',
        isAdmin: false,
        work: holdingWork,
      });
      bypassController.tryRunInBackground({
        userId: 'user-3',
        isAdmin: false,
        work: holdingWork,
      });
      expect(bypassController.getActiveCount()).toBe(3);

      // Admin should bypass system limit
      const adminResult = bypassController.tryRunInBackground({
        userId: 'admin-1',
        isAdmin: true,
        work: holdingWork,
      });
      expect(adminResult.ok).toBe(true);
      expect(bypassController.getActiveCount()).toBe(4);
    });

    it('admin still subject to per-user limit even with adminBypassCapacityLimit=true', () => {
      const bypassController = createConcurrencyController({
        ...BASE_CONFIG,
        adminBypassCapacityLimit: true,
      });

      const holdingWork = (): Promise<void> =>
        new Promise(() => {
          /* never resolves */
        });

      // Admin occupies their own per-user slot
      bypassController.tryRunInBackground({
        userId: 'admin-1',
        isAdmin: true,
        work: holdingWork,
      });

      // Second from same admin — should hit per-user limit
      const second = bypassController.tryRunInBackground({
        userId: 'admin-1',
        isAdmin: true,
        work: holdingWork,
      });
      expect(second.ok).toBe(false);
      if (!second.ok) {
        expect(second.reason).toBe('user-concurrency-limit');
      }
    });

    it('admin without adminBypassCapacityLimit=false is subject to system limit', () => {
      const noBypassController = createConcurrencyController({
        ...BASE_CONFIG,
        adminBypassCapacityLimit: false,
      });

      const holdingWork = (): Promise<void> =>
        new Promise(() => {
          /* never resolves */
        });

      // Fill system with non-admin
      noBypassController.tryRunInBackground({
        userId: 'user-1',
        isAdmin: false,
        work: holdingWork,
      });
      noBypassController.tryRunInBackground({
        userId: 'user-2',
        isAdmin: false,
        work: holdingWork,
      });
      noBypassController.tryRunInBackground({
        userId: 'user-3',
        isAdmin: false,
        work: holdingWork,
      });

      // Admin should be rejected because bypass is disabled
      const adminResult = noBypassController.tryRunInBackground({
        userId: 'admin-1',
        isAdmin: true,
        work: holdingWork,
      });
      expect(adminResult.ok).toBe(false);
      if (!adminResult.ok) {
        expect(adminResult.reason).toBe('system-concurrency-limit');
      }
    });
  });

  // -------------------------------------------------------------------------
  // 5. Work throws — finally must release slot
  // -------------------------------------------------------------------------

  describe('work throwing — finally releases slot', () => {
    it('decrements counter when work throws', async () => {
      const work = (): Promise<void> =>
        Promise.reject(new Error('work failed'));

      controller.tryRunInBackground({ userId: 'user-1', isAdmin: false, work });
      expect(controller.getActiveCount()).toBe(1);

      await flushMicrotasks();

      expect(controller.getActiveCount()).toBe(0);
      expect(controller.getActiveCount({ userId: 'user-1' })).toBe(0);
    });

    it('slot is reusable after work throws', async () => {
      const throwingWork = (): Promise<void> =>
        Promise.reject(new Error('intentional error'));

      controller.tryRunInBackground({
        userId: 'user-1',
        isAdmin: false,
        work: throwingWork,
      });

      await flushMicrotasks();

      // Slot should be free now — next request must succeed
      const second = controller.tryRunInBackground({
        userId: 'user-1',
        isAdmin: false,
        work: async () => {},
      });
      expect(second.ok).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Counters return to 0 after work completes
  // -------------------------------------------------------------------------

  describe('counter invariants after work completes', () => {
    it('system and per-user counters both return to 0 after work resolves', async () => {
      let resolveWork!: () => void;
      const workCalled = new Promise<void>((outer) => {
        const work = (): Promise<void> =>
          new Promise<void>((inner) => {
            resolveWork = inner;
            outer(); // signal that work has been invoked
          });

        controller.tryRunInBackground({
          userId: 'user-1',
          isAdmin: false,
          work,
        });
      });

      // Wait until work() has actually been called by the microtask
      await workCalled;

      resolveWork();
      await flushMicrotasks();

      expect(controller.getActiveCount()).toBe(0);
      expect(controller.getActiveCount({ userId: 'user-1' })).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 7. reset()
  // -------------------------------------------------------------------------

  describe('reset()', () => {
    it('clears all counters immediately', () => {
      const holdingWork = (): Promise<void> =>
        new Promise(() => {
          /* never resolves */
        });

      controller.tryRunInBackground({
        userId: 'user-1',
        isAdmin: false,
        work: holdingWork,
      });
      controller.tryRunInBackground({
        userId: 'user-2',
        isAdmin: false,
        work: holdingWork,
      });
      expect(controller.getActiveCount()).toBe(2);

      controller.reset();

      expect(controller.getActiveCount()).toBe(0);
      expect(controller.getActiveCount({ userId: 'user-1' })).toBe(0);
      expect(controller.getActiveCount({ userId: 'user-2' })).toBe(0);
    });

    it('allows new requests after reset', () => {
      const holdingWork = (): Promise<void> =>
        new Promise(() => {
          /* never resolves */
        });

      // Fill all system slots
      controller.tryRunInBackground({
        userId: 'user-1',
        isAdmin: false,
        work: holdingWork,
      });
      controller.tryRunInBackground({
        userId: 'user-2',
        isAdmin: false,
        work: holdingWork,
      });
      controller.tryRunInBackground({
        userId: 'user-3',
        isAdmin: false,
        work: holdingWork,
      });

      controller.reset();

      // Should accept new requests
      const result = controller.tryRunInBackground({
        userId: 'user-4',
        isAdmin: false,
        work: async () => {},
      });
      expect(result.ok).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 8. getActiveCount with userId filter
  // -------------------------------------------------------------------------

  describe('getActiveCount({ userId })', () => {
    it('returns per-user count when userId is provided', () => {
      const holdingWork = (): Promise<void> =>
        new Promise(() => {
          /* never resolves */
        });

      // Use a controller with maxConcurrentPerUser: 2 to verify the counter
      const twoPerUserController = createConcurrencyController({
        maxConcurrentPerUser: 2,
        maxConcurrentSystem: 10,
        adminBypassCapacityLimit: false,
      });

      twoPerUserController.tryRunInBackground({
        userId: 'user-1',
        isAdmin: false,
        work: holdingWork,
      });
      twoPerUserController.tryRunInBackground({
        userId: 'user-1',
        isAdmin: false,
        work: holdingWork,
      });
      twoPerUserController.tryRunInBackground({
        userId: 'user-2',
        isAdmin: false,
        work: holdingWork,
      });

      expect(twoPerUserController.getActiveCount({ userId: 'user-1' })).toBe(2);
      expect(twoPerUserController.getActiveCount({ userId: 'user-2' })).toBe(1);
      expect(twoPerUserController.getActiveCount()).toBe(3);
    });

    it('returns 0 for a userId that has no active slots', () => {
      expect(controller.getActiveCount({ userId: 'unknown-user' })).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 9. Type-level: release is not in public surface
  // -------------------------------------------------------------------------

  describe('public surface contract', () => {
    it('does not expose a release method on the returned interface', () => {
      // Type-level check: accessing any "release"-like property should be
      // undefined at runtime (not part of the interface).
      const ctrl = createConcurrencyController(BASE_CONFIG);

      // biome-ignore lint/suspicious/noExplicitAny: intentional surface check
      expect((ctrl as any).release).toBeUndefined();
      // biome-ignore lint/suspicious/noExplicitAny: intentional surface check
      expect((ctrl as any).releaseSlot).toBeUndefined();
    });
  });
});
