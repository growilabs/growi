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
/**
 * Result returned by triggerGc(), containing object counts and timing.
 */
export interface GcResult {
  /** Loose object count before gc. */
  readonly looseObjectCountBefore: number;
  /** Loose object count after gc (may be lower due to packing/pruning). */
  readonly looseObjectCountAfter: number;
  /** Wall-clock elapsed time in milliseconds. */
  readonly elapsedMs: number;
}
export interface VaultMaintenanceScheduler {
  /** Starts the periodic maintenance interval. */
  start(): void;
  /** Stops the periodic maintenance interval. */
  stop(): void;
  /** Returns the timestamp of the last successful squash, or null. */
  getLastSquashAt(): Date | null;
  /** Returns the timestamp of the last successful git gc, or null. */
  getLastGcAt(): Date | null;
  /**
   * Manually triggers a git gc run regardless of thresholds.
   * Returns before/after loose object counts and elapsed time.
   */
  triggerGc(): Promise<GcResult>;
}
/**
 * Creates a VaultMaintenanceScheduler instance.
 *
 * Call `start()` to begin the 5-minute maintenance loop.
 * Call `stop()` to clear the interval and halt future ticks.
 */
export declare function createVaultMaintenanceScheduler(): VaultMaintenanceScheduler;
