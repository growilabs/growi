/**
 * reconcile-concurrency-controller.ts
 *
 * In-memory per-user and system-wide concurrency slot manager for
 * the growi-vault-reconcile feature.
 *
 * Public API surface (3 methods only):
 *   - tryRunInBackground(opts)  — acquire slot + schedule work + auto-release
 *   - getActiveCount(opts?)     — query current active count (total or per-user)
 *   - reset()                   — clear all counters (test use only)
 *
 * Internal release is NOT exposed on the public interface; the caller
 * is never responsible for releasing slots (enforced at the type level).
 *
 * Requirements: 6.6, 6.7, 7.6
 */

import loggerFactory from '~/utils/logger/index.js';

const logger = loggerFactory(
  'growi:features:growi-vault:service:reconcile:concurrency-controller',
);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SlotAcquireRejection = {
  readonly ok: false;
  readonly reason: 'user-concurrency-limit' | 'system-concurrency-limit';
};
export type SlotAcquireSuccess = { readonly ok: true };
export type SlotAcquireResult = SlotAcquireSuccess | SlotAcquireRejection;

export interface ConcurrencyController {
  /**
   * Attempts to acquire a concurrency slot for the given user.
   *
   * If a slot is available, the work callback is scheduled as a microtask
   * (via Promise.resolve().then(...)) and { ok: true } is returned
   * synchronously. The slot is guaranteed to be released in the finally block
   * regardless of whether work resolves or throws.
   *
   * If no slot is available (per-user or system-wide limit reached),
   * { ok: false, reason: ... } is returned and work is NOT scheduled.
   *
   * NOTE: Returns synchronously. work() runs asynchronously after the return.
   */
  tryRunInBackground(opts: {
    userId: string;
    isAdmin: boolean;
    work: () => Promise<void>;
  }): SlotAcquireResult;

  /**
   * Returns the number of currently active (in-flight) reconcile slots.
   *
   * @param opts.userId — when provided, returns the count only for that user;
   *                      when omitted, returns the system-wide total.
   */
  getActiveCount(opts?: { userId?: string }): number;

  /**
   * Resets all counters to zero.
   * For test use only — do NOT call in production runtime.
   */
  reset(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a new ConcurrencyController with the given configuration.
 *
 * @param config.maxConcurrentPerUser    — per-user slot limit (default 1)
 * @param config.maxConcurrentSystem     — system-wide slot limit (default 3)
 * @param config.adminBypassCapacityLimit — when true, admin requests skip
 *                                          the system-wide limit check
 *                                          (per-user limit still applies)
 */
export function createConcurrencyController(config: {
  maxConcurrentPerUser: number;
  maxConcurrentSystem: number;
  adminBypassCapacityLimit: boolean;
}): ConcurrencyController {
  const {
    maxConcurrentPerUser,
    maxConcurrentSystem,
    adminBypassCapacityLimit,
  } = config;

  // per-user active counts
  const perUserCount = new Map<string, number>();
  // system-wide active count
  let systemCount = 0;

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  function getUserCount(userId: string): number {
    return perUserCount.get(userId) ?? 0;
  }

  /**
   * Synchronously checks limits and, if both are satisfied, increments the
   * per-user and system-wide counters atomically (safe in Node.js
   * single-threaded model).
   *
   * Returns ok: true if the slot was acquired, or the reject reason otherwise.
   */
  function tryAcquire(opts: {
    userId: string;
    isAdmin: boolean;
  }): SlotAcquireResult {
    const { userId, isAdmin } = opts;

    // Check per-user limit first (applies to all users including admins)
    if (getUserCount(userId) >= maxConcurrentPerUser) {
      return { ok: false, reason: 'user-concurrency-limit' };
    }

    // Check system-wide limit — skipped for admins when bypass is enabled
    const bypassSystemLimit = isAdmin && adminBypassCapacityLimit;
    if (!bypassSystemLimit && systemCount >= maxConcurrentSystem) {
      return { ok: false, reason: 'system-concurrency-limit' };
    }

    // Acquire: increment both counters atomically
    perUserCount.set(userId, getUserCount(userId) + 1);
    systemCount += 1;

    return { ok: true };
  }

  /**
   * Decrements both the per-user and system-wide counters.
   * Guards against going below zero (defensive, should not happen in practice).
   */
  function release(opts: { userId: string }): void {
    const { userId } = opts;

    const current = getUserCount(userId);
    if (current > 0) {
      perUserCount.set(userId, current - 1);
    }

    if (systemCount > 0) {
      systemCount -= 1;
    }
  }

  // -------------------------------------------------------------------------
  // Public interface
  // -------------------------------------------------------------------------

  return {
    tryRunInBackground(opts: {
      userId: string;
      isAdmin: boolean;
      work: () => Promise<void>;
    }): SlotAcquireResult {
      const { userId, isAdmin, work } = opts;

      // 1. Synchronous check + increment (atomic in Node.js single-thread model)
      const acquired = tryAcquire({ userId, isAdmin });
      if (!acquired.ok) {
        return acquired;
      }

      // 2. Schedule work as a microtask.
      //    Promise.resolve().then(callback) schedules callback without blocking
      //    the current synchronous call frame. The try/finally guarantees
      //    release even if work throws.
      Promise.resolve().then(async () => {
        try {
          await work();
        } catch (err) {
          logger.error('reconcile background work failed', err);
        } finally {
          release({ userId });
        }
      });

      return { ok: true };
    },

    getActiveCount(opts?: { userId?: string }): number {
      if (opts?.userId != null) {
        return getUserCount(opts.userId);
      }
      return systemCount;
    },

    reset(): void {
      perUserCount.clear();
      systemCount = 0;
    },
  };
}
