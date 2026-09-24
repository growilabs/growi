import { type MockProxy, mock } from 'vitest-mock-extended';

import type { DistributedLock } from '../types/index.js';
import {
  createSweeper,
  type ExpirySweep,
  SWEEP_INTERVAL_MS,
  SWEEP_LOCK_KEY,
  SWEEP_LOCK_TTL_MS,
  type SweeperDeps,
} from './sweeper.js';

interface Harness {
  readonly deps: SweeperDeps;
  readonly calls: string[];
  readonly locks: MockProxy<DistributedLock>;
  readonly reportFailure: ReturnType<typeof vi.fn>;
  readonly scheduled: Array<{ run: () => void; delayMs: number }>;
  readonly cancelled: () => number;
}

/** A lock that always grants, recording the order it was taken and given back. */
const grantingLock = (calls: string[]): MockProxy<DistributedLock> => {
  const locks = mock<DistributedLock>();
  locks.acquire.mockImplementation(() => {
    calls.push('acquire');
    return Promise.resolve(true);
  });
  locks.release.mockImplementation(() => {
    calls.push('release');
    return Promise.resolve();
  });
  return locks;
};

const sweepNamed = (name: string, calls: string[]): ExpirySweep => ({
  name,
  deleteExpired: vi.fn(() => {
    calls.push(`sweep:${name}`);
    return Promise.resolve(1);
  }),
});

type HarnessOverrides = Omit<Partial<SweeperDeps>, 'locks'> & {
  readonly locks?: MockProxy<DistributedLock>;
};

const harness = (overrides: HarnessOverrides = {}): Harness => {
  const calls: string[] = [];
  const locks = overrides.locks ?? grantingLock(calls);
  const scheduled: Array<{ run: () => void; delayMs: number }> = [];
  let cancelCount = 0;
  const reportFailure = vi.fn();

  const deps: SweeperDeps = {
    locks,
    sweeps: [sweepNamed('nonces', calls), sweepNamed('orders', calls)],
    listInstallationIds: vi.fn(() => {
      calls.push('list');
      return Promise.resolve(['inst-1', 'inst-2']);
    }),
    refreshChannels: vi.fn((installationId: string) => {
      calls.push(`refresh:${installationId}`);
      return Promise.resolve();
    }),
    reportFailure,
    schedule: (run, delayMs) => {
      scheduled.push({ run, delayMs });
      return () => {
        cancelCount += 1;
      };
    },
    ...overrides,
  };

  return {
    deps,
    calls,
    locks,
    reportFailure,
    scheduled,
    cancelled: () => cancelCount,
  };
};

describe('one sweep cycle', () => {
  it('takes the lock before it touches anything, and gives it back after', async () => {
    const h = harness();

    await expect(createSweeper(h.deps).sweepOnce()).resolves.toBe(true);

    // The whole point of the ordering assertion: a cycle that swept first and
    // locked afterwards would still call both, and `toHaveBeenCalled()` on
    // each would pass while two instances deleted the same rows.
    expect(h.calls).toEqual([
      'acquire',
      'sweep:nonces',
      'sweep:orders',
      'list',
      'refresh:inst-1',
      'refresh:inst-2',
      'release',
    ]);
    expect(h.locks.acquire).toHaveBeenCalledWith(
      SWEEP_LOCK_KEY,
      SWEEP_LOCK_TTL_MS,
    );
    expect(h.locks.release).toHaveBeenCalledWith(SWEEP_LOCK_KEY);
  });

  it('passes one instant to every sweep, so a cycle cannot straddle two clocks', async () => {
    const at = new Date('2026-03-01T00:00:00.000Z');
    const h = harness({ now: () => at });

    await createSweeper(h.deps).sweepOnce();

    for (const sweep of h.deps.sweeps) {
      expect(sweep.deleteExpired).toHaveBeenCalledWith(at);
    }
  });
});

describe('when another instance holds the lock', () => {
  it('skips the whole cycle rather than part of it', async () => {
    const h = harness();
    h.locks.acquire.mockResolvedValue(false);

    await expect(createSweeper(h.deps).sweepOnce()).resolves.toBe(false);

    expect(h.calls).toEqual([]);
    for (const sweep of h.deps.sweeps) {
      expect(sweep.deleteExpired).not.toHaveBeenCalled();
    }
    expect(h.deps.listInstallationIds).not.toHaveBeenCalled();
    expect(h.deps.refreshChannels).not.toHaveBeenCalled();
    // Nothing was taken, so nothing may be given back -- releasing a lock this
    // instance does not hold would hand the holder's turn to a third instance.
    expect(h.locks.release).not.toHaveBeenCalled();
  });

  it('sweeps and refreshes exactly once across two instances sharing one lock', async () => {
    // The property task 9.2 names: 「複数台で起動しても、同じ掃除と同じ取り直しが
    // 二重に走らない」. One lock, two sweepers, one grant.
    let held = false;
    const grantOnce = mock<DistributedLock>();
    grantOnce.acquire.mockImplementation(() => {
      if (held) return Promise.resolve(false);
      held = true;
      return Promise.resolve(true);
    });

    const first = harness({ locks: grantOnce });
    const second = harness({ locks: grantOnce });

    const outcomes = await Promise.all([
      createSweeper(first.deps).sweepOnce(),
      createSweeper(second.deps).sweepOnce(),
    ]);

    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const swept = [...first.calls, ...second.calls].filter((call) =>
      call.startsWith('sweep:'),
    );
    const refreshed = [...first.calls, ...second.calls].filter((call) =>
      call.startsWith('refresh:'),
    );
    expect(swept).toEqual(['sweep:nonces', 'sweep:orders']);
    expect(refreshed).toEqual(['refresh:inst-1', 'refresh:inst-2']);
  });
});

describe('a failure inside a cycle', () => {
  it('reports the sweep that failed, runs the rest, and still gives the lock back', async () => {
    const calls: string[] = [];
    const failing: ExpirySweep = {
      name: 'nonces',
      deleteExpired: () => Promise.reject(new Error('storage is unreachable')),
    };
    const h = harness({ sweeps: [failing, sweepNamed('orders', calls)] });
    // The harness's own `calls` array is not the one the surviving sweep
    // writes to, so read the outcome from the mocks instead.

    await expect(createSweeper(h.deps).sweepOnce()).resolves.toBe(true);

    expect(calls).toEqual(['sweep:orders']);
    expect(h.deps.refreshChannels).toHaveBeenCalledTimes(2);
    expect(h.locks.release).toHaveBeenCalledWith(SWEEP_LOCK_KEY);
    expect(h.reportFailure).toHaveBeenCalledTimes(1);
    expect(h.reportFailure.mock.calls[0]?.[0]).toContain('nonces');
  });

  it('reports one installation that could not be refreshed and refreshes the others', async () => {
    const h = harness({
      refreshChannels: vi.fn((installationId: string) =>
        installationId === 'inst-1'
          ? Promise.reject(new Error('service refused'))
          : Promise.resolve(),
      ),
    });

    await expect(createSweeper(h.deps).sweepOnce()).resolves.toBe(true);

    expect(h.deps.refreshChannels).toHaveBeenCalledTimes(2);
    expect(h.reportFailure).toHaveBeenCalledTimes(1);
    expect(h.reportFailure.mock.calls[0]?.[0]).toContain('inst-1');
    expect(h.locks.release).toHaveBeenCalledWith(SWEEP_LOCK_KEY);
  });

  it('gives the lock back even when listing the installations fails', async () => {
    const h = harness({
      listInstallationIds: vi.fn(() =>
        Promise.reject(new Error('storage is unreachable')),
      ),
    });

    await expect(createSweeper(h.deps).sweepOnce()).resolves.toBe(true);

    expect(h.deps.refreshChannels).not.toHaveBeenCalled();
    expect(h.reportFailure).toHaveBeenCalledTimes(1);
    expect(h.locks.release).toHaveBeenCalledWith(SWEEP_LOCK_KEY);
  });
});

describe('the schedule it drives itself', () => {
  it('does not sweep at start, and arms the first tick one interval away', () => {
    const h = harness();

    createSweeper(h.deps).start();

    // design.md gives the FIRST channel refresh to `InstallationStore.save()`
    // (「最初の 1 回」), so starting the process must not sweep immediately.
    expect(h.locks.acquire).not.toHaveBeenCalled();
    expect(h.scheduled).toHaveLength(1);
    expect(h.scheduled[0]?.delayMs).toBe(SWEEP_INTERVAL_MS);
  });

  it('arms the next tick after the one before it finished', async () => {
    const h = harness();
    const sweeper = createSweeper(h.deps);

    sweeper.start();
    h.scheduled[0]?.run();
    // Joins the cycle the tick started, then lets the tick's own
    // `.finally(armNextTick)` -- one link further down the same chain --
    // settle before the next tick is looked for.
    await sweeper.sweepOnce();
    await Promise.resolve();
    await Promise.resolve();

    expect(h.scheduled).toHaveLength(2);
    expect(h.scheduled[1]?.delayMs).toBe(SWEEP_INTERVAL_MS);
    // Exactly one cycle ran: the tick and the join are the same cycle.
    expect(h.locks.acquire).toHaveBeenCalledTimes(1);
  });

  it('stops arming further ticks once stopped', async () => {
    const h = harness();
    const sweeper = createSweeper(h.deps);

    sweeper.start();
    await sweeper.stop();

    expect(h.cancelled()).toBeGreaterThanOrEqual(1);
    const armed = h.scheduled.length;
    h.scheduled[0]?.run();
    await Promise.resolve();
    expect(h.scheduled).toHaveLength(armed);
  });
});

describe('the two periods it is configured with', () => {
  it('grants the lock for less than one interval', () => {
    // The opposite ratio to `LOCK_TTL_MS` >= 3x `RECONCILE_INTERVAL_MS` in
    // `platform/connection-manager.ts`, and deliberately so: that lock is held
    // ACROSS ticks and renewed, this one is taken and given back WITHIN a
    // tick. A grant outliving the interval would make an instance that died
    // mid-sweep skip the next cycle on every other instance too.
    expect(SWEEP_LOCK_TTL_MS).toBeLessThan(SWEEP_INTERVAL_MS);
  });
});
