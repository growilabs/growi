// 「期限切れの掃除」 -- design.md's File Structure Plan for this file, and the
// only place that wraps a lock and a schedule around the maintenance
// functions the lower layers expose for this purpose (tasks.md 9.2: 「ロックを
// 取って周期で回すのはここだけが持つ」). `platform/connection-manager.ts` also
// takes a lock on a period, but for connection ownership -- a different,
// pre-existing concern this file does not touch.
// Every layer below stops at offering a function; this is where a schedule and
// a lock are put around them.
//
// It does two kinds of work per cycle, both of which design.md assigns to one
// instance at a time:
//
//  1. **Reaping expired rows** -- `request_nonce`, `processed_notification_
//     target`, `pending_collection` and `pairing_order` (design.md's 期限切れ
//     の掃除 paragraph). Retention is what makes the replay refusals in
//     Requirement 10.4 enforceable without the tables growing without bound,
//     and reaping `pending_collection` is what stops a component posted long
//     ago from resuming a collection whose permission decision has gone stale
//     (Requirement 11.5).
//  2. **Re-taking the channel inventories** -- design.md 「proxy が
//     installation ごとに、自分の周期で `PlatformFacade.listChannels()` を
//     呼び、`installation_channel` に保存する」, and 「`sweeper` と同じく分散
//     ロックで 1 台だけが取り直す」.
//
// **It takes `DistributedLock`, not the whole `PlatformFacade`** -- design.md's
// File Structure Plan states this for this file by name. What it sweeps and
// which installations it refreshes arrive as parameters too, so the loop is
// exercisable without storage or a chat service, and `runtime/dependencies.ts`
// stays the only file that knows which repositories exist
// (`.claude/rules/coding-style.md`, "executors take their work-set as input").
//
// **The lock's grant is SHORTER than the interval, the opposite ratio to
// `platform/connection-manager.ts`'s `LOCK_TTL_MS` >= 3x
// `RECONCILE_INTERVAL_MS`.** The two locks are held differently, so the two
// ratios are not in conflict: a connection lock is held ACROSS ticks and
// renewed, so a grant shorter than a few intervals lapses under a healthy
// owner. This lock is taken and given back WITHIN one tick, so a grant
// outliving the interval would make an instance that died mid-sweep block the
// next cycle on every other instance as well. `sweeper.spec.ts` asserts the
// ratio, so changing one period without the other fails the build.
//
// The lock is a safety net rather than something correctness rests on: both
// kinds of work are idempotent (deleting rows already past their expiry, and
// upserting an inventory by its primary key), so a cycle running twice changes
// nothing. What the lock buys is not doing the work N times on N instances.

import type { DistributedLock } from '../types/index.js';

/**
 * How often a cycle runs. Matched to design.md's stated channel-refresh period
 * (「自分の周期で（既定 10 分）」); design.md puts no separate number on the
 * expiry sweep, and running the two together is what keeps this the only
 * schedule in the app.
 */
export const SWEEP_INTERVAL_MS = 600_000;

/** How long the lock is granted for. See this file's header on the ratio. */
export const SWEEP_LOCK_TTL_MS = 300_000;

/**
 * Namespaced, because the Chat SDK's state shares one key space between the
 * distributed lock, event de-duplication and the per-thread locks
 * (`platform/index.ts`, `createPlatformBot`). The connection locks live under
 * `app:` / `installation:` (`CONNECTION_UNIT_TABLE`); this is neither.
 */
export const SWEEP_LOCK_KEY = 'proxy:sweep';

/** One table's reaping, named so a failure can say which one failed. */
export interface ExpirySweep {
  readonly name: string;
  readonly deleteExpired: (now: Date) => Promise<number>;
}

/** Cancels a pending tick -- a function, so nothing here names a timer type. */
type CancelTick = () => void;

export interface SweeperDeps {
  readonly locks: DistributedLock;
  /** What to reap, declared by the caller rather than imported here. */
  readonly sweeps: ReadonlyArray<ExpirySweep>;
  /** Whose channel inventories to re-take, read fresh every cycle. */
  readonly listInstallationIds: () => Promise<ReadonlyArray<string>>;
  readonly refreshChannels: (installationId: string) => Promise<void>;
  /**
   * Where a failure inside a cycle goes. This app has no logger; every layer
   * reports outward through a function its caller supplied. It is not optional
   * on purpose -- `runtime/dependencies.ts` already promises an operator that
   * a failed inventory refresh will be retried by 「the periodic refresh」,
   * and this is that retry, so a silent failure here empties that promise.
   */
  readonly reportFailure: (message: string, error?: unknown) => void;
  readonly now?: () => Date;
  readonly intervalMs?: number;
  readonly lockTtlMs?: number;
  readonly lockKey?: string;
  /** Arms one tick. Injected so a test can drive the schedule. */
  readonly schedule?: (run: () => void, delayMs: number) => CancelTick;
}

export interface Sweeper {
  /**
   * Begins the schedule. **Does not sweep now**: design.md gives the first
   * channel refresh of an installation to `InstallationStore.save()`
   * (「最初の 1 回」), so a cycle at startup would only repeat work that has
   * already been done, on every instance, at the moment they are all busiest.
   */
  start(): void;
  /** Stops the schedule and waits for a cycle already running. */
  stop(): Promise<void>;
  /**
   * Runs one cycle. Answers whether this instance held the lock -- `false`
   * means another instance is sweeping and nothing was touched here.
   * Public so the whole cycle is provable without waiting for a tick.
   */
  sweepOnce(): Promise<boolean>;
}

/**
 * A self-rescheduling timeout rather than an interval: an interval fires again
 * while the previous cycle is still running. `unref` keeps a pending tick from
 * holding the process open during shutdown.
 */
const defaultSchedule = (run: () => void, delayMs: number): CancelTick => {
  const handle = setTimeout(run, delayMs);
  handle.unref?.();
  return () => clearTimeout(handle);
};

export const createSweeper = (deps: SweeperDeps): Sweeper => {
  const now = deps.now ?? (() => new Date());
  const intervalMs = deps.intervalMs ?? SWEEP_INTERVAL_MS;
  const lockTtlMs = deps.lockTtlMs ?? SWEEP_LOCK_TTL_MS;
  const lockKey = deps.lockKey ?? SWEEP_LOCK_KEY;
  const schedule = deps.schedule ?? defaultSchedule;

  let inFlight: Promise<boolean> | null = null;
  let cancelTick: CancelTick | null = null;
  let running = false;

  /** Reaps and refreshes. Called only with the lock held. */
  const runWork = async (): Promise<void> => {
    // One instant for the whole cycle: reading the clock per table would let a
    // long cycle reap by two different "now"s, which is a difference nobody
    // reading the deleted counts could account for.
    const at = now();

    for (const sweep of deps.sweeps) {
      try {
        // biome-ignore lint/performance/noAwaitInLoops: one table at a time, so a slow reap does not pile deletes onto storage at once
        await sweep.deleteExpired(at);
      } catch (error) {
        // Reported and stepped over: one unreachable table must not keep the
        // other three growing, and the next cycle retries this one anyway.
        deps.reportFailure(
          `expired rows of ${sweep.name} could not be swept; the next cycle will retry`,
          error,
        );
      }
    }

    let installationIds: ReadonlyArray<string> = [];
    try {
      installationIds = await deps.listInstallationIds();
    } catch (error) {
      deps.reportFailure(
        'the installations whose channel inventories are refreshed could not be listed; no inventory was refreshed this cycle',
        error,
      );
    }

    for (const installationId of installationIds) {
      try {
        // biome-ignore lint/performance/noAwaitInLoops: one installation at a time, so a refresh does not call every workspace's service at once
        await deps.refreshChannels(installationId);
      } catch (error) {
        // design.md: 「取り直しの失敗 | 最後に取れた一覧をそのまま使い続ける」.
        // Nothing is written back, so the saved inventory stays the last one
        // that was actually taken.
        deps.reportFailure(
          `the channel inventory of installation ${installationId} could not be refreshed; the next cycle will retry`,
          error,
        );
      }
    }
  };

  const runCycle = async (): Promise<boolean> => {
    const acquired = await deps.locks.acquire(lockKey, lockTtlMs);
    // Nothing was taken, so nothing may be given back: releasing a lock this
    // instance does not hold would end the holder's turn mid-cycle.
    if (!acquired) return false;

    try {
      await runWork();
    } finally {
      try {
        await deps.locks.release(lockKey);
      } catch (error) {
        // The grant expires on its own, so this costs at most one skipped
        // cycle -- but an operator seeing cycles skipped deserves the reason.
        deps.reportFailure(
          'the sweep lock could not be given back; it will expire on its own',
          error,
        );
      }
    }
    return true;
  };

  const sweepOnce = (): Promise<boolean> => {
    // A call made while a cycle is running joins that cycle rather than
    // starting a second one -- the same rule `ConnectionManager.reconcile`
    // follows, and the reason the schedule below can arm unconditionally.
    inFlight ??= runCycle().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  const armNextTick = (): void => {
    if (!running) return;
    cancelTick?.();
    cancelTick = schedule(() => {
      void sweepOnce()
        // A cycle only rejects if acquiring the lock itself threw; everything
        // inside is already handled per item. Rejecting here would kill the
        // schedule that drives every later cycle.
        .catch((error: unknown) =>
          deps.reportFailure(
            'the sweep lock could not be taken; the next cycle will retry',
            error,
          ),
        )
        .finally(armNextTick);
    }, intervalMs);
  };

  return {
    start() {
      if (running) return;
      running = true;
      armNextTick();
    },

    async stop() {
      running = false;
      cancelTick?.();
      cancelTick = null;
      // Waited for rather than abandoned: a cycle halfway through holds the
      // lock, and leaving it would keep every other instance out until the
      // grant expires.
      if (inFlight != null) await inFlight;
    },

    sweepOnce,
  };
};
