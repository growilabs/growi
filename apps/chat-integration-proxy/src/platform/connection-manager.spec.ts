// Task 3.8: 「常時接続の生涯」.
//
// Every test here drives `reconcile()` explicitly rather than waiting for the
// manager's own timer, and asserts the **exact ordered sequence** of lock
// operations rather than a set of `toHaveBeenCalled()` checks. That choice is
// the lesson of tasks 3.6 / 3.7: a call-count assertion passes for an ordering
// that a real deployment rejects (a connection opened before its lock was
// acquired, a lock renewed after it was released), so the ordering itself is
// what is asserted.
import type { PlatformName } from '@growi/chat';
import { describe, expect, it, vi } from 'vitest';

import type { ConnectionUnit } from '../capabilities/index.js';
import type { DistributedLock } from '../types/index.js';
import {
  type ConnectionManagerDeps,
  type ConnectionUnitRef,
  createConnectionManager,
  LOCK_TTL_MS,
  RECONCILE_INTERVAL_MS,
  toConnectionStatusViews,
} from './connection-manager.js';
import type { InstallationProvider } from './installation-provider.js';

const UNITS: Readonly<Record<PlatformName, ConnectionUnit>> = {
  slack: { kind: 'per-app', lockKey: 'app:slack' },
  discord: { kind: 'per-app', lockKey: 'app:discord' },
  teams: { kind: 'none' },
  mattermost: { kind: 'per-installation', lockKeyPrefix: 'installation:' },
};

interface LockCall {
  readonly op: 'acquire' | 'renew' | 'release';
  readonly key: string;
  readonly ttlMs?: number;
}

interface FakeLocks {
  readonly lock: DistributedLock;
  readonly calls: LockCall[];
}

/**
 * A `DistributedLock` that records every call in one array. It mirrors the
 * real one's contract in the single respect the reconciliation loop depends
 * on: a refused renewal forgets the token, so the caller cannot renew again
 * and has nothing left to release (`bot-factory.ts`'s `createDistributedLock`).
 */
const fakeLocks = (
  outcomes: {
    readonly acquire?: (key: string) => boolean;
    readonly renew?: (key: string) => boolean;
  } = {},
): FakeLocks => {
  const calls: LockCall[] = [];
  const held = new Set<string>();

  return {
    calls,
    lock: {
      acquire(key, ttlMs) {
        calls.push({ op: 'acquire', key, ttlMs });
        const granted = outcomes.acquire?.(key) ?? true;
        if (granted) held.add(key);
        return Promise.resolve(granted);
      },
      renew(key, ttlMs) {
        calls.push({ op: 'renew', key, ttlMs });
        const extended = outcomes.renew?.(key) ?? true;
        if (!extended) held.delete(key);
        return Promise.resolve(extended);
      },
      release(key) {
        calls.push({ op: 'release', key });
        held.delete(key);
        return Promise.resolve();
      },
    },
  };
};

const installationsOf = (
  byPlatform: Partial<Record<PlatformName, ReadonlyArray<string>>>,
): InstallationProvider => ({
  resolve: () => Promise.resolve(null),
  list: (platform) =>
    Promise.resolve(
      (byPlatform[platform] ?? []).map((installationId) => ({
        installationId,
        workspaceId: `${installationId}-workspace`,
      })),
    ),
});

interface Harness {
  readonly deps: ConnectionManagerDeps;
  readonly locks: FakeLocks;
  /** Every `open` / `close` in the order they happened, as `open:app:slack`. */
  readonly connections: string[];
}

const harness = (
  overrides: {
    readonly platforms?: ReadonlyArray<PlatformName>;
    readonly installations?: Partial<
      Record<PlatformName, ReadonlyArray<string>>
    >;
    readonly lockOutcomes?: {
      readonly acquire?: (key: string) => boolean;
      readonly renew?: (key: string) => boolean;
    };
    readonly installationProvider?: InstallationProvider;
    readonly open?: (unit: ConnectionUnitRef) => Promise<void>;
    readonly schedule?: (run: () => void, delayMs: number) => () => void;
    readonly now?: () => Date;
  } = {},
): Harness => {
  const locks = fakeLocks(overrides.lockOutcomes);
  const connections: string[] = [];

  return {
    locks,
    connections,
    deps: {
      platforms: overrides.platforms ?? ['slack', 'discord', 'teams'],
      units: UNITS,
      installations:
        overrides.installationProvider ??
        installationsOf(overrides.installations ?? {}),
      locks: locks.lock,
      open: async (unit) => {
        connections.push(`open:${unit.lockKey}`);
        await overrides.open?.(unit);
      },
      close: (unit) => {
        connections.push(`close:${unit.lockKey}`);
        return Promise.resolve();
      },
      now: overrides.now,
      schedule: overrides.schedule,
    },
  };
};

describe('lock lifetime vs. reconciliation interval', () => {
  it('keeps a lock alive for at least three cycles', () => {
    // design.md: 「ロックの寿命は回す間隔の 3 倍以上」. Asserted rather than
    // commented because the failure mode of breaking it -- an operator
    // lengthening only the interval -- is silent double processing.
    expect(LOCK_TTL_MS).toBeGreaterThanOrEqual(RECONCILE_INTERVAL_MS * 3);
  });
});

describe('acquiring and opening', () => {
  it('acquires the lock before opening the connection, per app-wide unit', async () => {
    const { deps, locks, connections } = harness();

    await createConnectionManager(deps).reconcile();

    expect(locks.calls).toEqual([
      { op: 'acquire', key: 'app:slack', ttlMs: LOCK_TTL_MS },
      { op: 'acquire', key: 'app:discord', ttlMs: LOCK_TTL_MS },
    ]);
    expect(connections).toEqual(['open:app:slack', 'open:app:discord']);
  });

  it('opens nothing for a service that holds no persistent connection', async () => {
    // Teams is configured here (it is in `platforms`) yet its connection unit
    // is `none`: the proxy never dials out to it.
    const { deps, locks, connections } = harness({ platforms: ['teams'] });

    await createConnectionManager(deps).reconcile();

    expect(locks.calls).toEqual([]);
    expect(connections).toEqual([]);
  });

  it('opens one connection per installation for a per-installation service', async () => {
    const { deps, locks, connections } = harness({
      platforms: ['mattermost'],
      installations: { mattermost: ['i1', 'i2'] },
    });

    await createConnectionManager(deps).reconcile();

    expect(locks.calls).toEqual([
      { op: 'acquire', key: 'installation:i1', ttlMs: LOCK_TTL_MS },
      { op: 'acquire', key: 'installation:i2', ttlMs: LOCK_TTL_MS },
    ]);
    expect(connections).toEqual([
      'open:installation:i1',
      'open:installation:i2',
    ]);
  });

  it('does not open a connection whose lock another instance holds', async () => {
    const { deps, locks, connections } = harness({
      platforms: ['slack'],
      lockOutcomes: { acquire: () => false },
    });
    const manager = createConnectionManager(deps);

    await manager.reconcile();

    expect(locks.calls).toEqual([
      { op: 'acquire', key: 'app:slack', ttlMs: LOCK_TTL_MS },
    ]);
    expect(connections).toEqual([]);
    expect((await manager.status())[0]?.state).toBe('held-by-other');
  });

  it('takes over a connection once the instance that held it is gone', async () => {
    // **This is the failure design.md says the whole loop exists to prevent**:
    // an instance that could not take a lock at startup must keep asking, or
    // the workspace whose owner died stays silent with nobody connecting to it
    // -- 「その workspace は誰もつながないまま黙り続ける」 -- and the only sign
    // is a user reporting that the bot stopped answering.
    let heldElsewhere = true;
    const { deps, locks, connections } = harness({
      platforms: ['slack'],
      lockOutcomes: { acquire: () => !heldElsewhere },
    });
    const manager = createConnectionManager(deps);

    await manager.reconcile();
    expect(connections).toEqual([]);

    heldElsewhere = false;
    await manager.reconcile();

    expect(locks.calls).toEqual([
      { op: 'acquire', key: 'app:slack', ttlMs: LOCK_TTL_MS },
      { op: 'acquire', key: 'app:slack', ttlMs: LOCK_TTL_MS },
    ]);
    expect(connections).toEqual(['open:app:slack']);
    expect(await manager.status()).toMatchObject([
      { lockKey: 'app:slack', state: 'connected' },
    ]);
  });

  it('gives the lock back when the connection could not be opened', async () => {
    // Holding a lock this instance cannot serve would keep every other
    // instance out of a connection nobody has.
    const { deps, locks, connections } = harness({
      platforms: ['slack'],
      open: () => Promise.reject(new Error('socket refused')),
    });
    const manager = createConnectionManager(deps);

    await manager.reconcile();

    expect(locks.calls).toEqual([
      { op: 'acquire', key: 'app:slack', ttlMs: LOCK_TTL_MS },
      { op: 'release', key: 'app:slack' },
    ]);
    expect(connections).toEqual(['open:app:slack']);
    expect((await manager.status())[0]?.state).toBe('reconnecting');
  });
});

describe('renewing what is already held', () => {
  it('renews rather than re-acquires on the next cycle', async () => {
    const { deps, locks, connections } = harness({ platforms: ['slack'] });
    const manager = createConnectionManager(deps);

    await manager.reconcile();
    await manager.reconcile();
    await manager.reconcile();

    expect(locks.calls).toEqual([
      { op: 'acquire', key: 'app:slack', ttlMs: LOCK_TTL_MS },
      { op: 'renew', key: 'app:slack', ttlMs: LOCK_TTL_MS },
      { op: 'renew', key: 'app:slack', ttlMs: LOCK_TTL_MS },
    ]);
    expect(connections).toEqual(['open:app:slack']);
  });

  it('closes its own connection when the renewal is refused, and takes the lock again later', async () => {
    // A refused renewal means another instance already holds the lock, so
    // this one must stop serving the connection rather than keep a stale one.
    let extend = true;
    const { deps, locks, connections } = harness({
      platforms: ['slack'],
      lockOutcomes: { renew: () => extend },
    });
    const manager = createConnectionManager(deps);

    await manager.reconcile();
    extend = false;
    await manager.reconcile();
    const afterLoss = (await manager.status())[0]?.state;
    await manager.reconcile();

    expect(locks.calls).toEqual([
      { op: 'acquire', key: 'app:slack', ttlMs: LOCK_TTL_MS },
      { op: 'renew', key: 'app:slack', ttlMs: LOCK_TTL_MS },
      // No release: the refused renewal already dropped the token, so there
      // is nothing this instance still owns to give back.
      { op: 'acquire', key: 'app:slack', ttlMs: LOCK_TTL_MS },
    ]);
    expect(connections).toEqual([
      'open:app:slack',
      'close:app:slack',
      'open:app:slack',
    ]);
    expect(afterLoss).toBe('reconnecting');
  });
});

describe('closing when the work is gone', () => {
  it('closes and releases a per-installation connection whose installation disappeared', async () => {
    let installations: ReadonlyArray<string> = ['i1'];
    const { deps, locks, connections } = harness({
      platforms: ['mattermost'],
      installationProvider: {
        resolve: () => Promise.resolve(null),
        list: () =>
          Promise.resolve(
            installations.map((installationId) => ({
              installationId,
              workspaceId: `${installationId}-workspace`,
            })),
          ),
      },
    });
    const manager = createConnectionManager(deps);

    await manager.reconcile();
    installations = [];
    await manager.reconcile();

    expect(locks.calls).toEqual([
      { op: 'acquire', key: 'installation:i1', ttlMs: LOCK_TTL_MS },
      { op: 'release', key: 'installation:i1' },
    ]);
    expect(connections).toEqual([
      'open:installation:i1',
      'close:installation:i1',
    ]);
    expect(await manager.status()).toEqual([]);
  });

  it('keeps an app-wide connection open after its last installation is removed', async () => {
    // design.md: 「アプリごとの接続は受け持ちが 0 件でも保つ」 -- what opens
    // it comes from the app's own configuration, and an OAuth callback can
    // add an installation at any moment.
    let installations: ReadonlyArray<string> = ['i1'];
    const { deps, locks, connections } = harness({
      platforms: ['slack'],
      installationProvider: {
        resolve: () => Promise.resolve(null),
        list: () =>
          Promise.resolve(
            installations.map((installationId) => ({
              installationId,
              workspaceId: `${installationId}-workspace`,
            })),
          ),
      },
    });
    const manager = createConnectionManager(deps);

    await manager.reconcile();
    installations = [];
    await manager.reconcile();

    expect(locks.calls).toEqual([
      { op: 'acquire', key: 'app:slack', ttlMs: LOCK_TTL_MS },
      { op: 'renew', key: 'app:slack', ttlMs: LOCK_TTL_MS },
    ]);
    expect(connections).toEqual(['open:app:slack']);
    expect(await manager.status()).toMatchObject([
      { lockKey: 'app:slack', state: 'connected', servedInstallationIds: [] },
    ]);
  });
});

describe('one connection failing does not reach the others', () => {
  it('still reconciles the remaining units when a lock operation throws', async () => {
    const { deps, locks, connections } = harness({
      platforms: ['slack', 'discord', 'mattermost'],
      installations: { mattermost: ['i1'] },
      lockOutcomes: {
        acquire: (key) => {
          if (key === 'app:slack') throw new Error('state unreachable');
          return true;
        },
      },
    });
    const manager = createConnectionManager(deps);

    await manager.reconcile();

    expect(locks.calls.map((call) => call.key)).toEqual([
      'app:slack',
      'app:discord',
      'installation:i1',
    ]);
    expect(connections).toEqual(['open:app:discord', 'open:installation:i1']);
    expect(await manager.status()).toMatchObject([
      { lockKey: 'app:slack', state: 'reconnecting' },
      { lockKey: 'app:discord', state: 'connected' },
      { lockKey: 'installation:i1', state: 'connected' },
    ]);
  });

  it('does not close a service whose installation list could not be read', async () => {
    // Treating an unreadable list as "zero installations" would close every
    // connection of that service on a transient storage failure.
    const { deps, connections } = harness({
      platforms: ['mattermost'],
      installationProvider: (() => {
        let readable = true;
        return {
          resolve: () => Promise.resolve(null),
          list: () => {
            if (!readable) {
              readable = true;
              return Promise.reject(new Error('storage unreachable'));
            }
            readable = false;
            return Promise.resolve([
              { installationId: 'i1', workspaceId: 'w1' },
            ]);
          },
        };
      })(),
    });
    const manager = createConnectionManager(deps);

    await manager.reconcile();
    await manager.reconcile();

    expect(connections).toEqual(['open:installation:i1']);
    expect(await manager.status()).toMatchObject([
      { lockKey: 'installation:i1', state: 'connected' },
    ]);
  });
});

describe('one cycle at a time', () => {
  it('does not start a second pass while the first is still running', async () => {
    // design.md: 「前の周回が終わる前に次を始めない」 -- overlapping cycles
    // open two connections to the same target.
    // A holder rather than two `let`s: assigning inside a callback leaves
    // TypeScript's flow analysis believing they are still unset.
    const gate: {
      release?: () => void;
      entered?: () => void;
    } = {};
    const entered = new Promise<void>((resolve) => {
      gate.entered = resolve;
    });
    const { deps, locks, connections } = harness({
      platforms: ['slack'],
      open: () =>
        new Promise<void>((resolve) => {
          gate.release = resolve;
          gate.entered?.();
        }),
    });
    const manager = createConnectionManager(deps);

    const first = manager.reconcile();
    await entered;
    // A second caller arriving mid-cycle. Were it to start its own pass, it
    // would find the unit not yet connected and take the lock a second time.
    const second = manager.reconcile();

    gate.release?.();
    await Promise.all([first, second]);

    expect(locks.calls).toEqual([
      { op: 'acquire', key: 'app:slack', ttlMs: LOCK_TTL_MS },
    ]);
    expect(connections).toEqual(['open:app:slack']);
  });
});

describe('the schedule it drives itself', () => {
  it('reconciles once on start and re-arms only after the cycle finished', async () => {
    const scheduled: Array<{ run: () => void; delayMs: number }> = [];
    const cancel = vi.fn();
    const { deps, connections } = harness({
      platforms: ['slack'],
      schedule: (run, delayMs) => {
        scheduled.push({ run, delayMs });
        return cancel;
      },
    });
    const manager = createConnectionManager(deps);

    await manager.start();
    expect(connections).toEqual(['open:app:slack']);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.delayMs).toBe(RECONCILE_INTERVAL_MS);

    scheduled[0]?.run();
    await manager.reconcile();
    expect(scheduled).toHaveLength(2);
  });

  it('stops the timer, closes every connection and gives every lock back', async () => {
    const scheduled: Array<{ run: () => void; delayMs: number }> = [];
    const cancel = vi.fn();
    const { deps, locks, connections } = harness({
      platforms: ['slack', 'mattermost'],
      installations: { mattermost: ['i1'] },
      schedule: (run, delayMs) => {
        scheduled.push({ run, delayMs });
        return cancel;
      },
    });
    const manager = createConnectionManager(deps);

    await manager.start();
    await manager.stopAll();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(connections).toEqual([
      'open:app:slack',
      'open:installation:i1',
      'close:app:slack',
      'close:installation:i1',
    ]);
    expect(locks.calls.slice(-2)).toEqual([
      { op: 'release', key: 'app:slack' },
      { op: 'release', key: 'installation:i1' },
    ]);
    expect(await manager.status()).toEqual([]);

    // A tick already queued when the stop arrived must not reconnect.
    scheduled[0]?.run();
    expect(connections).toHaveLength(4);
  });
});

describe('what the operator is shown', () => {
  const since = new Date('2026-09-03T00:00:00.000Z');

  it('reports a connection another instance holds as connected', () => {
    // design.md: 「別の台が持っている状態は『つながっている』に寄せる」 --
    // in a three-instance deployment the naive mapping would report a healthy
    // system as broken from two of the three.
    const views = toConnectionStatusViews(
      [
        {
          lockKey: 'app:slack',
          platform: 'slack',
          state: 'held-by-other',
          since,
          servedInstallationIds: ['i1'],
        },
      ],
      ['slack'],
      UNITS,
      since,
    );

    expect(views).toEqual([
      { platform: 'slack', health: 'connected', since: since.toISOString() },
    ]);
  });

  it('reports a service that holds no persistent connection as not-applicable', () => {
    expect(toConnectionStatusViews([], ['teams'], UNITS, since)).toEqual([
      {
        platform: 'teams',
        health: 'not-applicable',
        since: since.toISOString(),
      },
    ]);
  });

  it.each([
    ['connected', 'connected'],
    ['reconnecting', 'reconnecting'],
    ['failed', 'failed'],
    ['held-by-other', 'connected'],
  ] as const)('maps %s to %s', (state, health) => {
    const views = toConnectionStatusViews(
      [
        {
          lockKey: 'app:slack',
          platform: 'slack',
          state,
          since,
          servedInstallationIds: [],
        },
      ],
      ['slack'],
      UNITS,
      since,
    );

    expect(views[0]?.health).toBe(health);
  });

  it('reports the worst of a service spread over several connections', () => {
    const views = toConnectionStatusViews(
      [
        {
          lockKey: 'installation:i1',
          platform: 'mattermost',
          state: 'connected',
          since,
          servedInstallationIds: ['i1'],
        },
        {
          lockKey: 'installation:i2',
          platform: 'mattermost',
          state: 'failed',
          since: new Date('2026-09-03T01:00:00.000Z'),
          servedInstallationIds: ['i2'],
        },
      ],
      ['mattermost'],
      UNITS,
      since,
    );

    expect(views).toEqual([
      {
        platform: 'mattermost',
        health: 'failed',
        since: new Date('2026-09-03T01:00:00.000Z').toISOString(),
      },
    ]);
  });

  it('never discloses which installations a connection serves', () => {
    // Requirement: the external view is read by one GROWI, and the
    // installation list names every other tenant on this proxy.
    const views = toConnectionStatusViews(
      [
        {
          lockKey: 'app:slack',
          platform: 'slack',
          state: 'connected',
          since,
          servedInstallationIds: ['i1', 'i2', 'i3'],
        },
      ],
      ['slack'],
      UNITS,
      since,
    );

    expect(Object.keys(views[0] ?? {}).sort()).toEqual([
      'health',
      'platform',
      'since',
    ]);
  });
});

describe('a service whose installation list could not be read', () => {
  /**
   * `list` succeeds once, then fails for every later cycle. A connection is
   * already open and its lock already held when the failures start.
   */
  const unreadableAfterFirstRead = (
    installationIds: ReadonlyArray<string>,
  ): InstallationProvider => {
    let readable = true;
    return {
      resolve: () => Promise.resolve(null),
      list: () => {
        if (!readable) return Promise.reject(new Error('storage unreachable'));
        readable = false;
        return Promise.resolve(
          installationIds.map((installationId) => ({
            installationId,
            workspaceId: `${installationId}-workspace`,
          })),
        );
      },
    };
  };

  it('keeps renewing the lock of an app-wide connection it still holds', async () => {
    // **The lock has to be renewed even when this cycle learned nothing about
    // the service.** An unreadable list says nothing about the connection:
    // the socket is still open and the lock is still held. Stopping the
    // renewal lets the lock lapse after `LOCK_TTL_MS`, another instance takes
    // it and opens its own connection, and both process every event -- while
    // this instance still reports itself `connected`. That is the same double
    // processing the loop exists to prevent, arriving through a storage
    // failure instead of a dead owner.
    const { deps, locks, connections } = harness({
      platforms: ['slack'],
      installationProvider: unreadableAfterFirstRead(['i1']),
    });
    const manager = createConnectionManager(deps);

    await manager.reconcile();
    await manager.reconcile();
    await manager.reconcile();
    await manager.reconcile();

    expect(locks.calls).toEqual([
      { op: 'acquire', key: 'app:slack', ttlMs: LOCK_TTL_MS },
      { op: 'renew', key: 'app:slack', ttlMs: LOCK_TTL_MS },
      { op: 'renew', key: 'app:slack', ttlMs: LOCK_TTL_MS },
      { op: 'renew', key: 'app:slack', ttlMs: LOCK_TTL_MS },
    ]);
    expect(connections).toEqual(['open:app:slack']);
    // The list this instance serves is the last one it managed to read; a
    // failed read does not empty it.
    expect(await manager.status()).toMatchObject([
      {
        lockKey: 'app:slack',
        state: 'connected',
        servedInstallationIds: ['i1'],
      },
    ]);
  });

  it('keeps renewing the locks of per-installation connections it still holds', async () => {
    const { deps, locks, connections } = harness({
      platforms: ['mattermost'],
      installationProvider: unreadableAfterFirstRead(['i1', 'i2']),
    });
    const manager = createConnectionManager(deps);

    await manager.reconcile();
    await manager.reconcile();
    await manager.reconcile();

    expect(locks.calls).toEqual([
      { op: 'acquire', key: 'installation:i1', ttlMs: LOCK_TTL_MS },
      { op: 'acquire', key: 'installation:i2', ttlMs: LOCK_TTL_MS },
      { op: 'renew', key: 'installation:i1', ttlMs: LOCK_TTL_MS },
      { op: 'renew', key: 'installation:i2', ttlMs: LOCK_TTL_MS },
      { op: 'renew', key: 'installation:i1', ttlMs: LOCK_TTL_MS },
      { op: 'renew', key: 'installation:i2', ttlMs: LOCK_TTL_MS },
    ]);
    expect(connections).toEqual([
      'open:installation:i1',
      'open:installation:i2',
    ]);
    expect(await manager.status()).toMatchObject([
      { lockKey: 'installation:i1', state: 'connected' },
      { lockKey: 'installation:i2', state: 'connected' },
    ]);
  });
});

describe('backing off after repeated failures', () => {
  /**
   * A clock the test moves by hand. The backoff is measured in whole
   * reconciliation intervals, so a test that shortened the interval to zero
   * would switch off the very delay it is meant to check -- the interval stays
   * at its real length and time is what moves.
   */
  const controllableClock = () => {
    let elapsedMs = 0;
    return {
      now: () => new Date(elapsedMs),
      elapsedMs: () => elapsedMs,
      advance: (ms: number) => {
        elapsedMs += ms;
      },
    };
  };

  /**
   * Reconciles `cycles` times, one reconciliation interval apart, and returns
   * the cycle number of every cycle that reached for the lock and of every
   * cycle that tried to open the connection. Cycles missing from those lists
   * are the ones the backoff held back.
   *
   * **Both are recorded, not just the opens.** A backoff that delayed only the
   * open would still reach for the distributed lock on every single cycle,
   * which is a real cost -- one round trip per instance per cycle to the same
   * Postgres row -- and an `open`-only assertion cannot see it.
   */
  const attemptedCycles = async (
    cycles: number,
  ): Promise<{
    readonly attempts: ReadonlyArray<number>;
    readonly acquires: ReadonlyArray<number>;
    readonly state: string | undefined;
  }> => {
    const clock = controllableClock();
    const attempts: number[] = [];
    const acquires: number[] = [];
    const currentCycle = () => clock.elapsedMs() / RECONCILE_INTERVAL_MS;
    const { deps } = harness({
      platforms: ['slack'],
      now: clock.now,
      lockOutcomes: {
        acquire: () => {
          acquires.push(currentCycle());
          return true;
        },
      },
      open: () => {
        attempts.push(currentCycle());
        return Promise.reject(new Error('socket refused'));
      },
    });
    const manager = createConnectionManager(deps);

    for (let cycle = 0; cycle < cycles; cycle += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: cycles are sequential
      await manager.reconcile();
      clock.advance(RECONCILE_INTERVAL_MS);
    }

    return { attempts, acquires, state: (await manager.status())[0]?.state };
  };

  it('reports a connection that failed three times in a row as failed', async () => {
    // design.md: 「上限を超えたら `failed` として記録し、運用者に見える形で
    // 残す」. Retrying does not stop -- `failed` is what the operator sees,
    // not a decision to give up, which is why the later tests still show
    // attempts after this point.
    const afterTwo = await attemptedCycles(2);
    expect(afterTwo.state).toBe('reconnecting');

    const afterThree = await attemptedCycles(4);
    expect(afterThree.attempts).toEqual([0, 1, 3]);
    expect(afterThree.state).toBe('failed');
  });

  it('waits 2 ** (failures - 1) intervals before trying again', async () => {
    // Cycle 0 fails (1 interval of backoff), so cycle 1 may try; that failure
    // buys 2 intervals, so cycle 2 is held back and cycle 3 tries; that one
    // buys 4, so cycles 4-6 are held back and cycle 7 tries.
    const { attempts, acquires } = await attemptedCycles(8);

    expect(attempts).toEqual([0, 1, 3, 7]);
    // The held-back cycles do not reach for the lock either.
    expect(acquires).toEqual([0, 1, 3, 7]);
  });

  it('stops stretching the wait once it reaches the cap', async () => {
    // Uncapped, the fifth failure would wait 16 intervals and the sixth 32;
    // capped at `MAX_BACKOFF_INTERVALS` (8), every wait from the fourth
    // failure on is 8 intervals, so the attempts stay 8 apart.
    const { attempts, acquires } = await attemptedCycles(40);

    expect(attempts).toEqual([0, 1, 3, 7, 15, 23, 31, 39]);
    expect(acquires).toEqual([0, 1, 3, 7, 15, 23, 31, 39]);
  });
});
