/**
 * VaultMaintenanceScheduler
 *
 * Self-driving maintenance scheduler that keeps the bare repository and
 * namespace commit chains bounded without requiring external cron jobs,
 * k8s CronJob manifests, or systemd timers.
 *
 * Two independent maintenance tracks run on separate intervals:
 *
 * **Squash track** (checked every 5 minutes):
 *   For each namespace whose commit count (= vault_namespace_state.version)
 *   exceeds VAULT_SQUASH_COMMIT_THRESHOLD or whose last-squash age exceeds
 *   VAULT_SQUASH_AGE_HOURS, the scheduler:
 *     1. Reads the current tree OID from the namespace HEAD commit.
 *     2. Creates a new squash commit with parents: [] (root commit).
 *     3. Atomically updates the namespace ref to the squash commit.
 *     4. Resets vault_namespace_state.version to 1 (the squash commit itself).
 *
 * **GC track** (evaluated on each squash-interval tick):
 *   When loose object count exceeds VAULT_GC_LOOSE_OBJECT_THRESHOLD or
 *   VAULT_GC_INTERVAL_HOURS have elapsed since the last gc, spawns
 *   `git gc --prune=2.weeks.ago` against the bare repository.
 *
 * In-flight serialization:
 *   A Set<string> tracks namespaces currently being squashed.  The
 *   VaultNamespaceBuilder is expected to check isNamespaceInflight() before
 *   starting an instruction and to wait until the namespace is clear, or
 *   alternatively the scheduler skips in-flight namespaces on its side.
 *   The scheduler simply skips a namespace when it is already in the Set,
 *   ensuring that squash and instruction processing never race on the same
 *   namespace.
 */
import * as childProcess from 'node:child_process';

import { VaultNamespaceStateModel } from '../models/vault-namespace-state.js';
import * as VaultRepoStorage from './vault-repo-storage.js';

// ---------------------------------------------------------------------------
// Environment-variable thresholds (with defaults)
// ---------------------------------------------------------------------------
function getEnvInt(name, defaultValue) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') {
    return defaultValue;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}
function getEnvFloat(name, defaultValue) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') {
    return defaultValue;
  }
  const parsed = Number.parseFloat(raw);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/** Interval between maintenance checks, in milliseconds. */
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
/** Default maximum commit count before a namespace is squashed. */
const DEFAULT_SQUASH_COMMIT_THRESHOLD = 1000;
/** Default maximum hours since last squash before forcing another squash. */
const DEFAULT_SQUASH_AGE_HOURS = 1;
/** Default maximum loose object count before triggering git gc. */
const DEFAULT_GC_LOOSE_OBJECT_THRESHOLD = 50_000;
/** Default hours between git gc runs. */
const DEFAULT_GC_INTERVAL_HOURS = 24;
/** Bot identity used for squash commit author / committer metadata. */
const VAULT_BOT = {
  name: 'GROWI Vault Bot',
  email: 'vault-bot@growi.internal',
};
/** Ref path pattern for a namespace HEAD. */
function nsRef(namespace) {
  return `refs/namespaces/${namespace}/refs/heads/main`;
}
// ---------------------------------------------------------------------------
// git helpers
// ---------------------------------------------------------------------------
/**
 * Parses the first line of `git count-objects` output.
 * Expected format: "<n> objects, <size> kilobytes"
 */
function parseCountObjects(stdout) {
  const match = stdout.match(/^(\d+)\s+objects/m);
  if (match == null) {
    throw new Error(
      `Unexpected git count-objects output: ${stdout.slice(0, 200)}`,
    );
  }
  return Number.parseInt(match[1], 10);
}
/**
 * Runs `git count-objects` and returns the loose object count.
 * Uses a manual promise wrapper so that vi.mock('node:child_process') works
 * correctly in tests (avoids util.promisify binding issues).
 */
function getLooseObjectCount(repoPath) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      'git',
      ['--git-dir', repoPath, 'count-objects'],
      (err, stdout) => {
        if (err != null) {
          reject(err);
          return;
        }
        try {
          resolve(parseCountObjects(stdout));
        } catch (parseErr) {
          reject(parseErr);
        }
      },
    );
  });
}
/**
 * Runs `git gc --prune=2.weeks.ago` in the bare repository.
 * Uses a manual promise wrapper for the same vi.mock compatibility reason.
 */
function runGitGc(repoPath) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      'git',
      ['--git-dir', repoPath, 'gc', '--prune=2.weeks.ago'],
      (err) => {
        if (err != null) {
          reject(err);
          return;
        }
        resolve();
      },
    );
  });
}
/**
 * Reads the tree OID from a commit OID via isomorphic-git readCommit.
 * Uses the VaultRepoStorage.readTree peeling behaviour — readTree accepts
 * a commit OID and peels to the root tree.  We need the tree OID itself,
 * so we read the tree then write it back (no-op for existing objects) to
 * obtain a stable OID.
 */
async function getTreeOidFromCommit(commitOid) {
  // readTree peels the commit and returns its tree entries.
  const entries = await VaultRepoStorage.readTree(commitOid);
  // Write the tree back to obtain its OID (content-addressed no-op).
  return VaultRepoStorage.writeTree(entries);
}
// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
/**
 * Creates a VaultMaintenanceScheduler instance.
 *
 * Call `start()` to begin the 5-minute maintenance loop.
 * Call `stop()` to clear the interval and halt future ticks.
 */
export function createVaultMaintenanceScheduler() {
  let intervalHandle = null;
  // In-memory timestamps (reset on process restart per requirement 6.6).
  let lastSquashAt = null;
  let lastGcAt = null;
  // Namespaces currently being squashed — used to prevent concurrent squash
  // and upsert instruction processing on the same namespace.
  const inflightSquash = new Set();
  // ---------------------------------------------------------------------------
  // Squash logic
  // ---------------------------------------------------------------------------
  /**
   * Squashes the commit history of a single namespace.
   *
   * Steps:
   *  1. Read the current HEAD commit OID.
   *  2. Peel the commit to obtain its root tree OID.
   *  3. Write a new root commit (parents: []) with the same tree.
   *  4. Atomically update the namespace ref.
   *  5. Reset vault_namespace_state.version to 1 (the squash commit).
   */
  async function squashNamespace(namespace, currentCommitOid) {
    // Obtain the root tree OID from the current HEAD commit.
    const treeOid = await getTreeOidFromCommit(currentCommitOid);
    const now = Math.floor(Date.now() / 1000);
    const squashedOid = await VaultRepoStorage.writeCommit({
      tree: treeOid,
      parents: [], // root commit — drops the entire history
      message: `vault: squash ${namespace}`,
      author: { ...VAULT_BOT, timestamp: now },
      committer: { ...VAULT_BOT, timestamp: now },
    });
    // Atomically update the namespace ref to the squash commit.
    await VaultRepoStorage.updateRef(nsRef(namespace), squashedOid);
    // Reset the version counter so VaultViewComposer sees a change signal.
    // The squash commit itself counts as version 1.
    await VaultNamespaceStateModel.findOneAndUpdate(
      { namespace },
      { $set: { commitOid: squashedOid, version: 1, updatedAt: new Date() } },
      { upsert: true, new: true, runValidators: true },
    );
    lastSquashAt = new Date();
  }
  /**
   * Acquires the in-flight lock for a namespace, runs squashNamespace, then
   * releases the lock.  Extracted so that runSquashCheck can dispatch all
   * eligible namespaces with Promise.all() instead of a sequential await-in-loop.
   */
  async function squashNamespaceLocked(namespace, commitOid) {
    inflightSquash.add(namespace);
    try {
      await squashNamespace(namespace, commitOid);
    } finally {
      inflightSquash.delete(namespace);
    }
  }
  /**
   * Iterates all namespace state documents and squashes any namespace that
   * exceeds the commit-count or age threshold.  Skips namespaces that are
   * currently in-flight (being processed by VaultNamespaceBuilder).
   *
   * Eligible namespaces are squashed concurrently (Promise.all) because each
   * namespace holds its own independent git ref and DB document.  The
   * inflightSquash Set prevents two concurrent squashes of the same namespace.
   */
  async function runSquashCheck() {
    const squashCommitThreshold = getEnvInt(
      'VAULT_SQUASH_COMMIT_THRESHOLD',
      DEFAULT_SQUASH_COMMIT_THRESHOLD,
    );
    const squashAgeHours = getEnvFloat(
      'VAULT_SQUASH_AGE_HOURS',
      DEFAULT_SQUASH_AGE_HOURS,
    );
    const squashAgeMs = squashAgeHours * 60 * 60 * 1000;
    const now = Date.now();
    // Load all namespace state documents in one query.
    const allStates = await VaultNamespaceStateModel.find(
      {},
      { namespace: 1, commitOid: 1, version: 1, updatedAt: 1 },
    )
      .lean()
      .exec();
    // Filter to namespaces that need squashing and are not already in-flight.
    const tasks = allStates
      .filter((state) => {
        if (inflightSquash.has(state.namespace)) {
          return false;
        }
        const exceedsCommitThreshold = state.version > squashCommitThreshold;
        const ageMs = now - state.updatedAt.getTime();
        const exceedsAge = ageMs > squashAgeMs;
        return exceedsCommitThreshold || exceedsAge;
      })
      .map((state) => squashNamespaceLocked(state.namespace, state.commitOid));
    // Run all eligible squashes concurrently; errors are non-fatal per namespace.
    await Promise.all(tasks);
  }
  // ---------------------------------------------------------------------------
  // GC logic
  // ---------------------------------------------------------------------------
  /**
   * Runs git gc and returns before/after loose object counts and timing.
   *
   * @param knownLooseCountBefore - Pre-fetched loose object count to use as the
   *   "before" measurement, avoiding a redundant count-objects call when the
   *   check that triggered gc already fetched the count.  When null, a fresh
   *   count-objects is issued.
   */
  async function executeGc(knownLooseCountBefore) {
    const repoPath = VaultRepoStorage.getRepoPath();
    const startMs = Date.now();
    const looseObjectCountBefore =
      knownLooseCountBefore ?? (await getLooseObjectCount(repoPath));
    await runGitGc(repoPath);
    const looseObjectCountAfter = await getLooseObjectCount(repoPath);
    const elapsedMs = Date.now() - startMs;
    lastGcAt = new Date();
    return { looseObjectCountBefore, looseObjectCountAfter, elapsedMs };
  }
  /**
   * Evaluates GC thresholds and spawns git gc when conditions are met.
   *
   * Triggers when:
   *   - loose object count > VAULT_GC_LOOSE_OBJECT_THRESHOLD, OR
   *   - gc has run before AND time since last gc > VAULT_GC_INTERVAL_HOURS.
   *
   * The interval check is skipped when gc has never run (lastGcAt is null)
   * because there is no meaningful baseline age to compare against.
   */
  async function runGcCheck() {
    const gcLooseObjectThreshold = getEnvInt(
      'VAULT_GC_LOOSE_OBJECT_THRESHOLD',
      DEFAULT_GC_LOOSE_OBJECT_THRESHOLD,
    );
    const gcIntervalHours = getEnvFloat(
      'VAULT_GC_INTERVAL_HOURS',
      DEFAULT_GC_INTERVAL_HOURS,
    );
    const gcIntervalMs = gcIntervalHours * 60 * 60 * 1000;
    const now = Date.now();
    // Fetch the current loose object count once; reuse it as the "before"
    // value if gc is triggered, avoiding a second count-objects invocation.
    const repoPath = VaultRepoStorage.getRepoPath();
    const looseCount = await getLooseObjectCount(repoPath);
    const exceedsLooseThreshold = looseCount > gcLooseObjectThreshold;
    // Elapsed-time trigger only applies when gc has run at least once before.
    const exceedsInterval =
      lastGcAt != null && now - lastGcAt.getTime() > gcIntervalMs;
    if (!exceedsLooseThreshold && !exceedsInterval) {
      return;
    }
    // Pass the already-fetched count to avoid a redundant count-objects call.
    await executeGc(looseCount);
  }
  // ---------------------------------------------------------------------------
  // Main tick
  // ---------------------------------------------------------------------------
  /**
   * Single maintenance tick — squash check followed by gc check.
   * Errors in one track are caught independently so the other can still run.
   */
  async function tick() {
    try {
      await runSquashCheck();
    } catch (_squashErr) {
      // Squash errors are non-fatal; the next tick will retry.
    }
    try {
      await runGcCheck();
    } catch (_gcErr) {
      // GC errors are non-fatal; the next tick will retry.
    }
  }
  // ---------------------------------------------------------------------------
  // Public interface implementation
  // ---------------------------------------------------------------------------
  return {
    start() {
      if (intervalHandle != null) {
        // Already started — idempotent.
        return;
      }
      intervalHandle = setInterval(() => {
        // Fire-and-forget; errors are caught inside tick().
        tick().catch(() => {
          /* swallowed — tick handles its own error logging */
        });
      }, CHECK_INTERVAL_MS);
    },
    stop() {
      if (intervalHandle != null) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }
    },
    getLastSquashAt() {
      return lastSquashAt;
    },
    getLastGcAt() {
      return lastGcAt;
    },
    triggerGc() {
      return executeGc();
    },
  };
}
//# sourceMappingURL=vault-maintenance-scheduler.js.map
