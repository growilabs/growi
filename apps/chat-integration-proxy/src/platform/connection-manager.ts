// 「常時接続の生涯」 -- design.md's File Structure Plan for this file.
//
// This proxy is not a server that waits for webhooks: Slack arrives over Socket
// Mode, Mattermost over a WebSocket, and only Teams dials in. So connections
// have to be opened, kept, and closed, and several proxy instances share the
// work through one distributed lock per connection.
//
// **The shape that matters is "keep closing the gap", not "connect once at
// startup".** design.md spells out what breaks otherwise: an instance that
// only counts at startup never picks up a connection whose owner died, and a
// lock nobody renews expires under a perfectly healthy owner and lets a second
// instance process everything twice.
//
// Nothing here imports the Chat SDK. Opening and closing a connection are two
// injected functions, which is what lets the whole loop be exercised without a
// socket (`.claude/rules/coding-style.md`, "executors take their work-set as
// input") and keeps "which adapter serves this unit" in `platform/index.ts`,
// where the adapters are.
import type {
  ConnectionHealth,
  ConnectionStatusView,
  PlatformName,
} from '@growi/chat';

import type { ConnectionUnit } from '../capabilities/index.js';
import type { DistributedLock } from '../types/index.js';
import type { InstallationProvider } from './installation-provider.js';

/** How often the gap between the wanted and the current connections is closed. */
export const RECONCILE_INTERVAL_MS = 20_000;

/**
 * How long a lock is granted for.
 *
 * **Must stay at least three times `RECONCILE_INTERVAL_MS`** (design.md:
 * 「ロックの寿命は回す間隔の 3 倍以上」). At a smaller ratio a single slow
 * cycle lets a live owner's lock lapse, a second instance takes it, and both
 * process the same events. `connection-manager.spec.ts` asserts the ratio so
 * that lengthening only the interval fails the build instead of failing in
 * production.
 */
export const LOCK_TTL_MS = 60_000;

/**
 * How many consecutive failures a unit may have before it is reported as
 * `failed` rather than `reconnecting`. Retrying does not stop there -- the
 * state is what an operator is shown (design.md: 「上限を超えたら `failed` と
 * して記録し、運用者に見える形で残す」), not a decision to give up.
 */
const FAILURES_BEFORE_FAILED = 3;

/** The longest the backoff stretches, in whole reconciliation intervals. */
const MAX_BACKOFF_INTERVALS = 8;

/**
 * One thing that can be connected, named by the lock that decides who serves
 * it. `installationId` is `null` for an app-wide connection: Slack and Discord
 * open one connection for the whole app and every workspace's events arrive on
 * it, so no single installation names it.
 */
export interface ConnectionUnitRef {
  readonly lockKey: string;
  readonly platform: PlatformName;
  readonly installationId: string | null;
}

/**
 * `held-by-other` is a healthy state, not a fault: it says another proxy
 * instance holds this connection. Only the external view (see
 * `toConnectionStatusViews`) folds it into "connected"; internally the
 * difference is what tells "someone serves it" apart from "this instance
 * serves it", which is what the loop itself needs.
 */
export type ConnectionState =
  | 'connected'
  | 'reconnecting'
  | 'failed'
  | 'held-by-other';

/**
 * The state of one connection -- **not of one installation**. Slack and
 * Discord serve many installations over a single connection, so a
 * per-installation answer would repeat the same value once per workspace
 * (design.md).
 */
export interface ConnectionStatusRow {
  readonly lockKey: string;
  readonly platform: PlatformName;
  readonly state: ConnectionState;
  readonly since: Date;
  readonly servedInstallationIds: ReadonlyArray<string>;
}

export interface ConnectionManager {
  /** Reconciles once, then keeps reconciling on its own schedule. */
  start(): Promise<void>;
  /** Stops the schedule, closes every connection and gives every lock back. */
  stopAll(): Promise<void>;
  /**
   * Closes the gap between the connections that should exist and the ones that
   * do. Safe to call at any time: a call made while a cycle is still running
   * joins that cycle instead of starting a second one.
   */
  reconcile(): Promise<void>;
  status(): Promise<ReadonlyArray<ConnectionStatusRow>>;
}

/**
 * Cancels a pending tick. A function rather than a handle so that the caller
 * needs to inject only one thing (see `deps.schedule`), and so nothing here
 * names Node's timer types.
 */
type CancelTick = () => void;

export interface ConnectionManagerDeps {
  /**
   * The services this deployment actually serves. Passed in rather than read
   * from a table: whether a service is configured is a property of the
   * deployment (`PlatformAppConfig`), which this file cannot see.
   */
  readonly platforms: ReadonlyArray<PlatformName>;
  /** `CONNECTION_UNIT_TABLE` (`capabilities/`). */
  readonly units: Readonly<Record<PlatformName, ConnectionUnit>>;
  readonly installations: InstallationProvider;
  readonly locks: DistributedLock;
  /** Opens the connection this unit names. Rejecting means "could not open". */
  readonly open: (unit: ConnectionUnitRef) => Promise<void>;
  readonly close: (unit: ConnectionUnitRef) => Promise<void>;
  readonly now?: () => Date;
  readonly intervalMs?: number;
  readonly lockTtlMs?: number;
  /**
   * Arms one tick. Injected so a test can drive the schedule instead of
   * waiting for it, and so the loop's "one cycle at a time" rule is provable.
   */
  readonly schedule?: (run: () => void, delayMs: number) => CancelTick;
}

/**
 * A self-rescheduling timeout rather than an interval: an interval fires again
 * while the previous cycle is still running, which is exactly the overlap
 * design.md forbids. `unref` keeps a pending tick from holding the process
 * open during shutdown.
 */
const defaultSchedule = (run: () => void, delayMs: number): CancelTick => {
  const handle = setTimeout(run, delayMs);
  handle.unref?.();
  return () => clearTimeout(handle);
};

interface UnitRecord {
  unit: ConnectionUnitRef;
  state: ConnectionState;
  since: Date;
  servedInstallationIds: ReadonlyArray<string>;
  /** Consecutive failures to open, driving both the backoff and `failed`. */
  failures: number;
  /** Epoch ms before which no new attempt is made. */
  nextAttemptAt: number;
}

interface DesiredUnit {
  readonly unit: ConnectionUnitRef;
  readonly servedInstallationIds: ReadonlyArray<string>;
}

interface DesiredConnections {
  readonly units: ReadonlyArray<DesiredUnit>;
  /**
   * Services whose installation list could not be read this cycle, so that
   * `units` says nothing about them. **This decides only whether a connection
   * of that service may be closed, never whether its lock is renewed** -- see
   * `runCycle`.
   */
  readonly unreadablePlatforms: ReadonlySet<PlatformName>;
}

export const createConnectionManager = (
  deps: ConnectionManagerDeps,
): ConnectionManager => {
  const now = deps.now ?? (() => new Date());
  const intervalMs = deps.intervalMs ?? RECONCILE_INTERVAL_MS;
  const lockTtlMs = deps.lockTtlMs ?? LOCK_TTL_MS;
  const schedule = deps.schedule ?? defaultSchedule;

  /** Insertion-ordered, so `status()` reads in the order units were first seen. */
  const records = new Map<string, UnitRecord>();
  let inFlight: Promise<void> | null = null;
  let cancelTick: CancelTick | null = null;
  let running = false;

  const moveTo = (record: UnitRecord, state: ConnectionState): void => {
    // `since` answers "how long has it been like this", so it only moves when
    // the state does.
    if (record.state === state) return;
    record.state = state;
    record.since = now();
  };

  const noteFailure = (record: UnitRecord): void => {
    record.failures += 1;
    const intervals = Math.min(
      2 ** (record.failures - 1),
      MAX_BACKOFF_INTERVALS,
    );
    record.nextAttemptAt = now().getTime() + intervals * intervalMs;
    moveTo(
      record,
      record.failures >= FAILURES_BEFORE_FAILED ? 'failed' : 'reconnecting',
    );
  };

  const desiredConnections = async (): Promise<DesiredConnections> => {
    const units: DesiredUnit[] = [];
    const unreadablePlatforms = new Set<PlatformName>();

    for (const platform of deps.platforms) {
      const unit = deps.units[platform];
      if (unit.kind === 'none') continue;

      let installations: ReadonlyArray<{ installationId: string }>;
      try {
        // Sequential on purpose: the list is short, and one service's failure
        // must not decide anything about another's.
        // biome-ignore lint/performance/noAwaitInLoops: one list per service
        installations = await deps.installations.list(platform);
      } catch {
        unreadablePlatforms.add(platform);
        continue;
      }

      const servedInstallationIds = installations.map(
        (installation) => installation.installationId,
      );

      if (unit.kind === 'per-app') {
        // Wanted whether or not any installation exists: what opens it comes
        // from the app's own configuration, and an OAuth callback can add an
        // installation to it at any moment (design.md).
        units.push({
          unit: { lockKey: unit.lockKey, platform, installationId: null },
          servedInstallationIds,
        });
        continue;
      }

      for (const installationId of servedInstallationIds) {
        units.push({
          unit: {
            lockKey: `${unit.lockKeyPrefix}${installationId}`,
            platform,
            installationId,
          },
          servedInstallationIds: [installationId],
        });
      }
    }

    return { units, unreadablePlatforms };
  };

  const reconcileUnit = async (record: UnitRecord): Promise<void> => {
    if (record.state === 'connected') {
      const extended = await deps.locks.renew(record.unit.lockKey, lockTtlMs);
      if (extended) return;

      // The lock is gone -- another instance may already hold it -- so this
      // instance stops serving the connection. Nothing is released: a refused
      // renewal already dropped the token (`createDistributedLock`), and
      // releasing would address a lock this process no longer owns.
      await deps.close(record.unit);
      moveTo(record, 'reconnecting');
      return;
    }

    if (now().getTime() < record.nextAttemptAt) return;

    const acquired = await deps.locks.acquire(record.unit.lockKey, lockTtlMs);
    if (!acquired) {
      // Someone else serves it. That is the system working, so the failure
      // count is cleared rather than backed off.
      record.failures = 0;
      record.nextAttemptAt = 0;
      moveTo(record, 'held-by-other');
      return;
    }

    try {
      await deps.open(record.unit);
    } catch {
      // Keeping a lock this instance cannot serve would lock every other
      // instance out of a connection nobody has.
      await deps.locks.release(record.unit.lockKey);
      noteFailure(record);
      return;
    }

    record.failures = 0;
    record.nextAttemptAt = 0;
    moveTo(record, 'connected');
  };

  const releaseAndClose = async (record: UnitRecord): Promise<void> => {
    if (record.state !== 'connected') return;
    await deps.close(record.unit);
    await deps.locks.release(record.unit.lockKey);
  };

  const runCycle = async (): Promise<void> => {
    const { units, unreadablePlatforms } = await desiredConnections();
    /**
     * The units this cycle read for itself. Only these answer "may a
     * connection be closed": a lock key absent from a *successful* read is
     * genuinely unwanted.
     */
    const freshlyRead = new Set(units.map((desired) => desired.unit.lockKey));

    /**
     * The units of a service whose list could not be read this cycle.
     *
     * **A failed read says nothing about a connection this instance is
     * already serving**, so what it was serving is carried forward unchanged
     * -- the same `servedInstallationIds` the last successful read gave it,
     * because there is no fresh data to recompute them from. Leaving these
     * out is what let a held lock expire under a live connection: with no
     * unit, nothing renewed the lock, another instance took it after
     * `lockTtlMs` and opened its own connection, and both processed every
     * event while this one still reported itself `connected`.
     *
     * "Which connections may be closed" and "which locks must be renewed" are
     * two different questions, which is why one exclusion set cannot answer
     * both.
     */
    const carriedOver: ReadonlyArray<DesiredUnit> = [...records.values()]
      .filter(
        (record) =>
          unreadablePlatforms.has(record.unit.platform) &&
          !freshlyRead.has(record.unit.lockKey),
      )
      .map((record) => ({
        unit: record.unit,
        servedInstallationIds: record.servedInstallationIds,
      }));

    for (const { unit, servedInstallationIds } of [...units, ...carriedOver]) {
      const record: UnitRecord = records.get(unit.lockKey) ?? {
        unit,
        state: 'reconnecting',
        since: now(),
        servedInstallationIds,
        failures: 0,
        nextAttemptAt: 0,
      };
      record.unit = unit;
      record.servedInstallationIds = servedInstallationIds;
      records.set(unit.lockKey, record);

      try {
        // Sequential and individually guarded: 「1 つの接続の失敗を他へ波及
        // させない」 (Requirement 1.4). `Promise.all` would let one rejection
        // abandon the units after it.
        // biome-ignore lint/performance/noAwaitInLoops: one connection at a time
        await reconcileUnit(record);
      } catch {
        noteFailure(record);
      }
    }

    for (const [lockKey, record] of [...records]) {
      if (freshlyRead.has(lockKey)) continue;
      // An unreadable list looks exactly like "no installations", so closing
      // on it would drop every connection of that service over a momentary
      // storage failure. The renewal above already kept these alive.
      if (unreadablePlatforms.has(record.unit.platform)) continue;

      try {
        // biome-ignore lint/performance/noAwaitInLoops: one connection at a time
        await releaseAndClose(record);
      } catch {
        // Isolated for the same reason as above; the record is dropped either
        // way, because this instance no longer serves the unit.
      }
      records.delete(lockKey);
    }
  };

  const reconcile = (): Promise<void> => {
    // 「前の周回が終わる前に次を始めない」 -- a caller arriving mid-cycle
    // joins the cycle in progress. The guard lives here rather than only in
    // the scheduler because `reconcile()` is part of the public interface.
    if (inFlight != null) return inFlight;

    inFlight = runCycle()
      // A cycle never rejects: every failure it can name is already handled
      // per unit, and a rejection here would kill the schedule that drives
      // every later cycle. This app has no logger to report the rest to.
      .catch(() => undefined)
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  const armNextTick = (): void => {
    if (!running) return;
    cancelTick?.();
    cancelTick = schedule(() => {
      void reconcile().finally(armNextTick);
    }, intervalMs);
  };

  return {
    async start() {
      if (running) return;
      running = true;
      await reconcile();
      armNextTick();
    },

    async stopAll() {
      running = false;
      cancelTick?.();
      cancelTick = null;
      // Waited for rather than raced: a cycle in flight may be halfway through
      // opening something, and closing it before it exists would leave it open.
      if (inFlight != null) await inFlight;

      for (const record of records.values()) {
        try {
          // biome-ignore lint/performance/noAwaitInLoops: one connection at a time
          await releaseAndClose(record);
        } catch {
          // One connection refusing to close must not keep the others open.
        }
      }
      records.clear();
    },

    reconcile,

    status() {
      return Promise.resolve(
        [...records.values()].map((record) => ({
          lockKey: record.unit.lockKey,
          platform: record.unit.platform,
          state: record.state,
          since: record.since,
          servedInstallationIds: record.servedInstallationIds,
        })),
      );
    },
  };
};

/**
 * How an internal state reads to whoever asked. **`held-by-other` becomes
 * `connected`** (design.md): which instance holds a connection is not the
 * caller's concern, and reporting "disconnected" from every non-owning
 * instance would make a healthy three-instance deployment look broken from two
 * of the three.
 */
const HEALTH_BY_STATE: Readonly<Record<ConnectionState, ConnectionHealth>> = {
  connected: 'connected',
  'held-by-other': 'connected',
  reconnecting: 'reconnecting',
  failed: 'failed',
};

/** Worst first: a service spread over several connections reports its worst. */
const HEALTH_SEVERITY: ReadonlyArray<ConnectionHealth> = [
  'failed',
  'reconnecting',
  'connected',
];

/**
 * The status as it leaves this proxy (`ConnectionStatusView`, `@growi/chat`).
 *
 * Three things differ from the internal rows, each on purpose:
 *
 * - **One row per service, not per connection.** The external type names no
 *   connection, and a proxy serving a hundred Mattermost installations would
 *   otherwise answer a hundred rows.
 * - **`servedInstallationIds` is dropped.** One GROWI reads this, and that
 *   list names every other tenant on the proxy.
 * - **A service that opens no connection reports `not-applicable`**, never
 *   "disconnected" -- Teams dials in, so there is nothing here to be
 *   disconnected from.
 *
 * A connection-bearing service with no rows at all is left out rather than
 * given an invented health: before the first reconciliation, and for a
 * per-installation service with no installations, there is nothing to report.
 */
export const toConnectionStatusViews = (
  rows: ReadonlyArray<ConnectionStatusRow>,
  platforms: ReadonlyArray<PlatformName>,
  units: Readonly<Record<PlatformName, ConnectionUnit>>,
  /** What `since` says for a service that never opens a connection. */
  fallbackSince: Date,
): ReadonlyArray<ConnectionStatusView> =>
  platforms.flatMap((platform) => {
    if (units[platform].kind === 'none') {
      return [
        {
          platform,
          health: 'not-applicable' as const,
          since: fallbackSince.toISOString(),
        },
      ];
    }

    const own = rows.filter((row) => row.platform === platform);
    if (own.length === 0) return [];

    const worst = own.reduce((worstSoFar, row) =>
      HEALTH_SEVERITY.indexOf(HEALTH_BY_STATE[row.state]) <
      HEALTH_SEVERITY.indexOf(HEALTH_BY_STATE[worstSoFar.state])
        ? row
        : worstSoFar,
    );

    return [
      {
        platform,
        health: HEALTH_BY_STATE[worst.state],
        since: worst.since.toISOString(),
      },
    ];
  });
