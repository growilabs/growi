/**
 * Unit tests for VaultMaintenanceScheduler (Task 10.1 + 10.2)
 *
 * All external dependencies — VaultRepoStorage, VaultNamespaceStateModel,
 * child_process.execFile, and setInterval/clearInterval — are fully mocked
 * so that tests run without a real git repository or MongoDB instance.
 *
 * Test coverage:
 *   Squash track:
 *     - version > threshold  → squash is executed
 *     - version <= threshold → squash is not executed
 *     - elapsed time > age threshold → squash is executed
 *   GC track:
 *     - loose object count > threshold → git gc is executed
 *     - elapsed time since last gc > interval → git gc is executed
 *   Threshold override:
 *     - env vars override defaults
 *   Accessors:
 *     - getLastSquashAt() / getLastGcAt() return correct timestamps
 */

import * as childProcess from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before importing the module under test
// ---------------------------------------------------------------------------

const { mockLoggerError } = vi.hoisted(() => ({
  mockLoggerError: vi.fn(),
}));

vi.mock('@growi/logger', () => ({
  loggerFactory: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: mockLoggerError,
    debug: vi.fn(),
  }),
}));

vi.mock('./vault-repo-storage.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./vault-repo-storage.js')>();
  return {
    ...actual,
    getRepoPath: vi.fn(() => '/data/vault-repo.git'),
    assertRefsReadable: vi.fn(),
    readRef: vi.fn(),
    readCommitParents: vi.fn(),
    readTree: vi.fn(),
    writeTree: vi.fn(),
    writeCommit: vi.fn(),
    updateRef: vi.fn(),
  };
});

vi.mock('../models/vault-namespace-state.js', () => ({
  VaultNamespaceStateModel: {
    find: vi.fn(),
    findOneAndUpdate: vi.fn(),
  },
}));

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return { ...original, execFile: vi.fn() };
});

// ---------------------------------------------------------------------------
// Imports — after vi.mock declarations
// ---------------------------------------------------------------------------

import { VaultNamespaceStateModel } from '../models/vault-namespace-state.js';
import {
  createVaultMaintenanceScheduler,
  type VaultMaintenanceScheduler,
} from './vault-maintenance-scheduler.js';
import { withNamespaceLock } from './vault-namespace-lock.js';
import * as VaultRepoStorage from './vault-repo-storage.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** One 5-minute maintenance tick in milliseconds. */
const ONE_TICK_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Snapshot of IVaultNamespaceState shape used by scheduler queries. */
interface NamespaceStateRow {
  namespace: string;
  commitOid?: string;
  version: number;
  updatedAt: Date;
}

/**
 * Configures VaultNamespaceStateModel.find() to return the given rows via
 * a lean().exec() call chain.
 */
function mockFind(rows: NamespaceStateRow[]): void {
  vi.mocked(VaultNamespaceStateModel.find).mockReturnValue({
    lean: vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(rows),
    }),
  } as unknown as ReturnType<typeof VaultNamespaceStateModel.find>);
}

/**
 * Configures VaultNamespaceStateModel.findOneAndUpdate() to resolve with
 * a minimal document.
 */
function mockFindOneAndUpdate(): void {
  vi.mocked(VaultNamespaceStateModel.findOneAndUpdate).mockResolvedValue({
    namespace: 'test',
    commitOid: 'squashed000',
    version: 1,
    updatedAt: new Date(),
  });
}

/**
 * Typed handle for the mocked execFile. The Node.js execFile has many
 * overloads that make vi.mocked() incompatible with a simple callback signature,
 * so we cast through unknown.
 */
// biome-ignore lint/suspicious/noExplicitAny: overloaded Node.js API
type AnyFn = (...args: any[]) => void;
const mockedExecFile = childProcess.execFile as unknown as {
  mockImplementation: (fn: AnyFn) => void;
  mockReset: () => void;
  mock: { calls: unknown[][] };
};

/**
 * Configures execFile to deliver responses in sequence, looping on the last
 * entry when exhausted.  Each response is either { stdout } for success or
 * { err } for failure.
 */
function mockExecFileSequence(
  responses: Array<{ stdout?: string; err?: Error }>,
): void {
  let callIndex = 0;
  // biome-ignore lint/suspicious/noExplicitAny: overloaded Node.js API
  mockedExecFile.mockImplementation((...args: any[]) => {
    const callback = args[args.length - 1];
    const response = responses[Math.min(callIndex, responses.length - 1)];
    callIndex++;
    if (response.err != null) {
      callback(response.err, '', '');
    } else {
      callback(null, response.stdout ?? '', '');
    }
  });
}

/**
 * Sets execFile to always respond with a successful count-objects output for
 * `count` loose objects.  Used when gc is not expected to fire.
 */
function mockCountObjects(count: number): void {
  mockExecFileSequence([
    { stdout: `${count} objects, 0 kilobytes\n` },
    // Extra entries in case the gc check also calls count-objects.
    { stdout: `${count} objects, 0 kilobytes\n` },
  ]);
}

/**
 * Sets execFile to model the full gc sequence:
 *   call 1 → count-objects (before gc): returns `before` loose objects
 *   call 2 → git gc: succeeds silently
 *   call 3 → count-objects (after gc): returns `after` loose objects
 */
function mockGcSequence(before: number, after: number): void {
  mockExecFileSequence([
    { stdout: `${before} objects, 0 kilobytes\n` },
    { stdout: '' }, // git gc output is irrelevant
    { stdout: `${after} objects, 0 kilobytes\n` },
  ]);
}

/**
 * Sets VaultRepoStorage mocks for a successful squash operation.
 */
function mockSquashStorage(
  treeOid = 'tree0000000000000000000000000000000000000',
  squashedOid = 'squashed00000000000000000000000000000000',
): void {
  vi.mocked(VaultRepoStorage.readRef).mockResolvedValue('abc123');
  vi.mocked(VaultRepoStorage.readCommitParents).mockResolvedValue([
    'parent0000000000000000000000000000000000',
  ]);
  vi.mocked(VaultRepoStorage.readTree).mockResolvedValue([]);
  vi.mocked(VaultRepoStorage.writeTree).mockResolvedValue(treeOid);
  vi.mocked(VaultRepoStorage.writeCommit).mockResolvedValue(squashedOid);
  vi.mocked(VaultRepoStorage.updateRef).mockResolvedValue(undefined);
}

/**
 * Resolves once the tick reaches its gc check, which runs only after every
 * squash dispatched by that tick has settled.
 */
function whenGcCheckRuns(): Promise<void> {
  return new Promise((resolve) => {
    // biome-ignore lint/suspicious/noExplicitAny: overloaded Node.js API
    mockedExecFile.mockImplementation((...args: any[]) => {
      resolve();
      const callback = args[args.length - 1];
      callback(null, '0 objects, 0 kilobytes\n', '');
    });
  });
}

/**
 * Advances fake timers by exactly one maintenance tick and flushes all
 * pending microtasks.  Avoids the infinite-loop that vi.runAllTimersAsync()
 * triggers with setInterval.
 */
async function runOneTick(): Promise<void> {
  await vi.advanceTimersByTimeAsync(ONE_TICK_MS);
}

/** Finds every execFile call that runs the given git sub-command. */
function findExecFileCalls(subCommand: string): unknown[][] {
  return vi
    .mocked(childProcess.execFile)
    .mock.calls.filter(
      (args) =>
        Array.isArray(args[1]) && (args[1] as string[]).includes(subCommand),
    );
}

/**
 * Finds an execFile call that matches the given git sub-command (e.g. 'gc').
 */
function findExecFileCall(subCommand: string): unknown[] | undefined {
  return vi
    .mocked(childProcess.execFile)
    .mock.calls.find(
      (args) =>
        Array.isArray(args[1]) && (args[1] as string[]).includes(subCommand),
    );
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('VaultMaintenanceScheduler', () => {
  let scheduler: VaultMaintenanceScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    // Clear env vars that affect thresholds so defaults are used.
    delete process.env.VAULT_SQUASH_COMMIT_THRESHOLD;
    delete process.env.VAULT_SQUASH_AGE_HOURS;
    delete process.env.VAULT_GC_LOOSE_OBJECT_THRESHOLD;
    delete process.env.VAULT_GC_INTERVAL_HOURS;

    scheduler = createVaultMaintenanceScheduler();
  });

  afterEach(() => {
    scheduler.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // start / stop
  // ---------------------------------------------------------------------------

  describe('start() / stop()', () => {
    it('sets up a 5-minute interval', () => {
      const spy = vi.spyOn(global, 'setInterval');
      scheduler.start();
      expect(spy).toHaveBeenCalledWith(expect.any(Function), ONE_TICK_MS);
    });

    it('is idempotent — calling start() twice does not add a second interval', () => {
      const spy = vi.spyOn(global, 'setInterval');
      scheduler.start();
      scheduler.start();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('clears the interval on stop()', () => {
      const spy = vi.spyOn(global, 'clearInterval');
      scheduler.start();
      scheduler.stop();
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Squash track
  // ---------------------------------------------------------------------------

  describe('squash: version > threshold', () => {
    it('executes squash when version exceeds VAULT_SQUASH_COMMIT_THRESHOLD', async () => {
      // version 1001 > default threshold 1000; updatedAt is recent so age
      // threshold does not trigger independently.
      const now = new Date();
      mockFind([
        {
          namespace: 'public',
          version: 1001,
          updatedAt: now,
        },
      ]);
      mockSquashStorage();
      mockFindOneAndUpdate();
      mockCountObjects(0);

      scheduler.start();
      await runOneTick();

      expect(VaultRepoStorage.writeCommit).toHaveBeenCalledWith(
        expect.objectContaining({ parents: [] }),
      );
      expect(VaultRepoStorage.updateRef).toHaveBeenCalledWith(
        'refs/namespaces/public/refs/heads/main',
        expect.any(String),
      );
      expect(VaultNamespaceStateModel.findOneAndUpdate).toHaveBeenCalledWith(
        { namespace: 'public' },
        expect.objectContaining({
          $set: expect.objectContaining({ version: 1 }),
        }),
        expect.any(Object),
      );
    });
  });

  describe('squash: version <= threshold', () => {
    it('does not execute squash when version equals the threshold', async () => {
      const now = new Date();
      // version 1000 equals default threshold 1000 — strict > check means NO squash
      mockFind([
        {
          namespace: 'public',
          version: 1000,
          updatedAt: now,
        },
      ]);
      mockCountObjects(0);

      scheduler.start();
      await runOneTick();

      expect(VaultRepoStorage.writeCommit).not.toHaveBeenCalled();
      expect(VaultRepoStorage.updateRef).not.toHaveBeenCalled();
    });
  });

  describe('squash: elapsed time > age threshold', () => {
    it('executes squash when updatedAt is older than VAULT_SQUASH_AGE_HOURS', async () => {
      // updatedAt is 2 hours ago; default age threshold is 1 hour → triggers
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      // version is well below commit threshold so only age triggers squash
      mockFind([
        {
          namespace: 'public',
          version: 5,
          updatedAt: twoHoursAgo,
        },
      ]);
      mockSquashStorage();
      mockFindOneAndUpdate();
      mockCountObjects(0);

      scheduler.start();
      await runOneTick();

      expect(VaultRepoStorage.writeCommit).toHaveBeenCalledWith(
        expect.objectContaining({ parents: [] }),
      );
    });

    it('does not squash when updatedAt is within the age threshold', async () => {
      // updatedAt is 30 minutes ago; threshold is 1 hour → no squash
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      mockFind([
        {
          namespace: 'public',
          version: 5,
          updatedAt: thirtyMinutesAgo,
        },
      ]);
      mockCountObjects(0);

      scheduler.start();
      await runOneTick();

      expect(VaultRepoStorage.writeCommit).not.toHaveBeenCalled();
    });
  });

  describe('squash: a namespace whose HEAD is already a single parentless commit', () => {
    const HEAD_OID = 'root000000000000000000000000000000000000';
    const twoHoursAgo = () => new Date(Date.now() - 2 * 60 * 60 * 1000);

    beforeEach(() => {
      mockSquashStorage();
      vi.mocked(VaultRepoStorage.readRef).mockResolvedValue(HEAD_OID);
      vi.mocked(VaultRepoStorage.readCommitParents).mockResolvedValue([]);
      mockFindOneAndUpdate();
      mockCountObjects(0);
    });

    it('is left untouched however long it has been idle', async () => {
      mockFind([
        {
          namespace: 'public',
          commitOid: HEAD_OID,
          version: 1,
          updatedAt: twoHoursAgo(),
        },
      ]);

      scheduler.start();
      await runOneTick();

      expect(VaultRepoStorage.updateRef).not.toHaveBeenCalled();
      expect(VaultNamespaceStateModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(scheduler.getLastSquashAt()).toBeNull();
    });

    it('is squashed once more when the state does not record that commit', async () => {
      mockFind([
        {
          namespace: 'public',
          commitOid: 'stale00000000000000000000000000000000000',
          version: 1001,
          updatedAt: new Date(),
        },
      ]);

      scheduler.start();
      await runOneTick();

      expect(VaultNamespaceStateModel.findOneAndUpdate).toHaveBeenCalledWith(
        { namespace: 'public' },
        expect.objectContaining({
          $set: expect.objectContaining({ version: 1 }),
        }),
        expect.any(Object),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // GC track
  // ---------------------------------------------------------------------------

  describe('gc: loose object count > threshold', () => {
    it('spawns git gc when loose object count exceeds VAULT_GC_LOOSE_OBJECT_THRESHOLD', async () => {
      mockFind([]);
      // 50001 > default threshold 50000 → triggers gc
      mockGcSequence(50_001, 100);

      scheduler.start();
      await runOneTick();

      expect(findExecFileCall('gc')).toBeDefined();
    });

    it('does not spawn git gc when loose object count is at the threshold', async () => {
      mockFind([]);
      // exactly 50000 — strict > check means NO gc
      mockCountObjects(50_000);

      scheduler.start();
      await runOneTick();

      expect(findExecFileCall('gc')).toBeUndefined();
    });
  });

  describe('gc: elapsed time since last gc > interval', () => {
    it('spawns git gc when VAULT_GC_INTERVAL_HOURS have elapsed since last gc', async () => {
      mockFind([]);

      // Establish lastGcAt via triggerGc().
      mockGcSequence(0, 0);
      await scheduler.triggerGc();
      expect(scheduler.getLastGcAt()).not.toBeNull();

      // Provide fresh mocks for the upcoming tick (set before advancing time).
      mockFind([]);
      // The gc sequence for the interval-triggered gc:
      //   call 1 → count-objects (check/before): returns 0 loose objects
      //   call 2 → git gc: success
      //   call 3 → count-objects (after): returns 0
      mockGcSequence(0, 0);

      // Reset call history so findExecFileCall only sees calls from this tick.
      vi.mocked(childProcess.execFile).mockClear();

      // Advance fake time by 25 hours (> 24h default interval).
      // Use advanceTimersByTimeAsync to properly update Date.now() and flush
      // any async work that depends on the clock.
      await vi.advanceTimersByTimeAsync(25 * 60 * 60 * 1000);

      // Start the scheduler and fire one tick (5 minutes further).
      scheduler.start();
      await runOneTick();

      expect(findExecFileCall('gc')).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // env var threshold overrides
  // ---------------------------------------------------------------------------

  describe('env var threshold overrides', () => {
    it('respects VAULT_SQUASH_COMMIT_THRESHOLD override', async () => {
      process.env.VAULT_SQUASH_COMMIT_THRESHOLD = '10';

      const now = new Date();
      // version 11 > override threshold 10 → squash
      mockFind([
        {
          namespace: 'public',
          version: 11,
          updatedAt: now,
        },
      ]);
      mockSquashStorage();
      mockFindOneAndUpdate();
      mockCountObjects(0);

      scheduler.start();
      await runOneTick();

      expect(VaultRepoStorage.writeCommit).toHaveBeenCalledWith(
        expect.objectContaining({ parents: [] }),
      );
    });

    it('respects VAULT_SQUASH_AGE_HOURS override', async () => {
      process.env.VAULT_SQUASH_AGE_HOURS = '0.1'; // 6 minutes

      // updatedAt is 10 minutes ago — exceeds the 6-minute override threshold
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      mockFind([
        {
          namespace: 'public',
          version: 0,
          updatedAt: tenMinutesAgo,
        },
      ]);
      mockSquashStorage();
      mockFindOneAndUpdate();
      mockCountObjects(0);

      scheduler.start();
      await runOneTick();

      expect(VaultRepoStorage.writeCommit).toHaveBeenCalled();
    });

    it('respects VAULT_GC_LOOSE_OBJECT_THRESHOLD override', async () => {
      process.env.VAULT_GC_LOOSE_OBJECT_THRESHOLD = '5';

      mockFind([]);
      // 6 loose objects > override threshold 5 → gc
      mockGcSequence(6, 0);

      scheduler.start();
      await runOneTick();

      expect(findExecFileCall('gc')).toBeDefined();
    });

    it('respects VAULT_GC_INTERVAL_HOURS override', async () => {
      process.env.VAULT_GC_INTERVAL_HOURS = '0.01'; // ~36 seconds

      mockFind([]);

      // Establish lastGcAt.
      mockGcSequence(0, 0);
      await scheduler.triggerGc();

      // Set up mocks for the upcoming tick, then clear call history so
      // findExecFileCall only sees calls from this tick.
      mockFind([]);
      mockGcSequence(0, 0);
      vi.mocked(childProcess.execFile).mockClear();

      // Advance by 60 seconds (> 36-second override interval) using the async
      // variant to properly update Date.now() for the elapsed-time check.
      await vi.advanceTimersByTimeAsync(60 * 1000);

      scheduler.start();
      await runOneTick();

      expect(findExecFileCall('gc')).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // getLastSquashAt / getLastGcAt
  // ---------------------------------------------------------------------------

  describe('getLastSquashAt()', () => {
    it('returns null before any squash has run', () => {
      expect(scheduler.getLastSquashAt()).toBeNull();
    });

    it('returns a Date after a successful squash', async () => {
      const now = new Date();
      mockFind([
        {
          namespace: 'public',
          version: 2000,
          updatedAt: now,
        },
      ]);
      mockSquashStorage();
      mockFindOneAndUpdate();
      mockCountObjects(0);

      scheduler.start();
      await runOneTick();

      const squashAt = scheduler.getLastSquashAt();
      expect(squashAt).not.toBeNull();
      expect(squashAt).toBeInstanceOf(Date);
    });
  });

  describe('getLastGcAt()', () => {
    it('returns null before any gc has run', () => {
      expect(scheduler.getLastGcAt()).toBeNull();
    });

    it('returns a Date after a successful gc via triggerGc()', async () => {
      mockGcSequence(0, 0);
      await scheduler.triggerGc();

      const gcAt = scheduler.getLastGcAt();
      expect(gcAt).not.toBeNull();
      expect(gcAt).toBeInstanceOf(Date);
    });
  });

  // ---------------------------------------------------------------------------
  // triggerGc()
  // ---------------------------------------------------------------------------

  describe('triggerGc()', () => {
    it('returns before/after loose object counts and elapsed time', async () => {
      mockGcSequence(300, 50);

      const result = await scheduler.triggerGc();

      expect(result.looseObjectCountBefore).toBe(300);
      expect(result.looseObjectCountAfter).toBe(50);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it('updates getLastGcAt()', async () => {
      mockGcSequence(0, 0);
      expect(scheduler.getLastGcAt()).toBeNull();
      await scheduler.triggerGc();
      expect(scheduler.getLastGcAt()).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Squash vs. instruction application on the same namespace
  // ---------------------------------------------------------------------------

  describe('squash vs. instruction application on the same namespace', () => {
    const REF = 'refs/namespaces/public/refs/heads/main';
    const TREES: Record<string, VaultRepoStorage.TreeEntry[]> = {
      c1: [{ mode: '100644', path: 'a.md', oid: 'blob-a', type: 'blob' }],
      c2: [
        { mode: '100644', path: 'a.md', oid: 'blob-a', type: 'blob' },
        { mode: '100644', path: 'b.md', oid: 'blob-b', type: 'blob' },
      ],
    };
    let heads: Map<string, string>;

    beforeEach(() => {
      heads = new Map([[REF, 'c1']]);
      vi.mocked(VaultRepoStorage.readRef).mockImplementation((ref) =>
        Promise.resolve(heads.get(ref) ?? null),
      );
      vi.mocked(VaultRepoStorage.readCommitParents).mockResolvedValue(['c0']);
      vi.mocked(VaultRepoStorage.readTree).mockImplementation((oid) =>
        Promise.resolve(TREES[oid] ?? []),
      );
      vi.mocked(VaultRepoStorage.writeTree).mockImplementation((entries) =>
        Promise.resolve(`tree:${entries.map((e) => e.path).join(',')}`),
      );
      vi.mocked(VaultRepoStorage.writeCommit).mockResolvedValue('squashed');
      vi.mocked(VaultRepoStorage.updateRef).mockImplementation((ref, oid) => {
        heads.set(ref, oid);
        return Promise.resolve();
      });
      mockFindOneAndUpdate();
      mockFind([
        {
          namespace: 'public',
          version: 1001,
          updatedAt: new Date(),
        },
      ]);
    });

    it('waits for an instruction holding the namespace, then squashes the HEAD that instruction left', async () => {
      let releaseInstruction: () => void = () => {};
      const instruction = withNamespaceLock(['public'], async () => {
        await new Promise<void>((r) => {
          releaseInstruction = r;
        });
        heads.set(REF, 'c2');
      });
      const gcCheck = whenGcCheckRuns();

      scheduler.start();
      await runOneTick();
      releaseInstruction();
      await instruction;
      await gcCheck;

      expect(VaultRepoStorage.writeCommit).toHaveBeenCalledTimes(1);
      expect(VaultRepoStorage.writeCommit).toHaveBeenCalledWith(
        expect.objectContaining({ tree: 'tree:a.md,b.md', parents: [] }),
      );
      expect(heads.get(REF)).toBe('squashed');
    });

    it('leaves the namespace alone when its ref is gone by the time its turn comes', async () => {
      let releaseInstruction: () => void = () => {};
      const resetAll = withNamespaceLock(['public'], async () => {
        await new Promise<void>((r) => {
          releaseInstruction = r;
        });
        heads.delete(REF);
      });
      const gcCheck = whenGcCheckRuns();

      scheduler.start();
      await runOneTick();
      releaseInstruction();
      await resetAll;
      await gcCheck;

      expect(heads.has(REF)).toBe(false);
      expect(VaultRepoStorage.updateRef).not.toHaveBeenCalled();
      expect(VaultNamespaceStateModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(scheduler.getLastSquashAt()).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Tick robustness
  // ---------------------------------------------------------------------------

  describe('tick robustness', () => {
    const PUBLIC_REF = 'refs/namespaces/public/refs/heads/main';
    const GROUP_REF = 'refs/namespaces/group-g1/refs/heads/main';
    let releaseWrites: () => void = () => {};

    beforeEach(() => {
      const writesGate = new Promise<void>((r) => {
        releaseWrites = r;
      });
      vi.mocked(VaultRepoStorage.readCommitParents).mockResolvedValue([
        'parent-oid',
      ]);
      vi.mocked(VaultRepoStorage.readTree).mockResolvedValue([]);
      vi.mocked(VaultRepoStorage.writeTree).mockResolvedValue('tree-oid');
      vi.mocked(VaultRepoStorage.writeCommit).mockImplementation(async () => {
        await writesGate;
        return 'squashed-oid';
      });
      vi.mocked(VaultRepoStorage.updateRef).mockResolvedValue(undefined);
      mockFindOneAndUpdate();
    });

    afterEach(() => {
      releaseWrites();
    });

    it('lets every squash settle before the gc check, even when one of them fails', async () => {
      mockFind([
        { namespace: 'public', version: 2000, updatedAt: new Date() },
        { namespace: 'group-g1', version: 2000, updatedAt: new Date() },
      ]);
      vi.mocked(VaultRepoStorage.readRef).mockImplementation((ref) =>
        ref === PUBLIC_REF
          ? Promise.reject(new Error('unreadable'))
          : Promise.resolve('abc123'),
      );
      let gcChecked = false;
      const gcCheck = whenGcCheckRuns().then(() => {
        gcChecked = true;
      });

      scheduler.start();
      await runOneTick();
      expect(gcChecked).toBe(false);

      releaseWrites();
      await gcCheck;
      expect(VaultRepoStorage.updateRef).toHaveBeenCalledWith(
        GROUP_REF,
        'squashed-oid',
      );
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({ namespace: 'public' }),
        expect.any(String),
      );
    });

    it('reports unreadable refs once per tick, not once per namespace, and still runs the gc check', async () => {
      mockLoggerError.mockClear();
      const unreadable = new Error('packed-refs found');
      vi.mocked(VaultRepoStorage.assertRefsReadable).mockRejectedValue(
        unreadable,
      );
      vi.mocked(VaultRepoStorage.readRef).mockRejectedValue(unreadable);
      mockFind([
        { namespace: 'public', version: 2000, updatedAt: new Date() },
        { namespace: 'group-g1', version: 2000, updatedAt: new Date() },
        { namespace: 'group-g2', version: 2000, updatedAt: new Date() },
      ]);
      const gcCheck = whenGcCheckRuns();

      scheduler.start();
      await runOneTick();
      await gcCheck;

      expect(mockLoggerError).toHaveBeenCalledTimes(1);
      expect(mockLoggerError).toHaveBeenCalledWith(
        { err: unreadable },
        expect.any(String),
      );
    });

    it('skips a tick while the previous one is still running', async () => {
      mockFind([{ namespace: 'public', version: 2000, updatedAt: new Date() }]);
      vi.mocked(VaultRepoStorage.readRef).mockResolvedValue('abc123');
      mockCountObjects(0);

      scheduler.start();
      await runOneTick();
      await runOneTick();
      releaseWrites();
      await vi.advanceTimersByTimeAsync(0);

      expect(findExecFileCalls('count-objects')).toHaveLength(1);
      expect(VaultRepoStorage.writeCommit).toHaveBeenCalledTimes(1);
    });
  });
});
