import type { VaultSyncStateModel } from '~/features/growi-vault/server/models/vault-sync-state';

/**
 * BootstrapHeartbeat manages the instance identity and liveness signal for a
 * running bootstrap process.
 *
 * Responsibilities:
 *   - Generate and persist a unique instance ID so concurrent restarts can
 *     detect that a different process has taken over (requirement 3.5).
 *   - Periodically update a heartbeat timestamp so peer processes can
 *     distinguish a live runner from a crashed one (requirement 3.5).
 *   - Detect stale-running state: bootstrapState === 'running' with a heartbeat
 *     older than the configured threshold (requirement 1.9).
 */
export interface BootstrapHeartbeat {
  /**
   * Generate a UUID and write bootstrapInstanceId + bootstrapHeartbeatAt to
   * the vault_sync_state singleton.
   * Returns the generated instanceId.
   */
  acquireInstance(): Promise<{ instanceId: string }>;

  /**
   * Start a setInterval that updates bootstrapHeartbeatAt every intervalMs.
   * Non-blocking; the interval runs in the background.
   */
  refresh(): void;

  /**
   * Clear the interval so future ticks no longer fire.
   */
  stop(): void;

  /**
   * Check whether the persisted bootstrap state is 'running' AND the
   * bootstrapHeartbeatAt timestamp is older than staleThresholdMs.
   * A null heartbeat with state 'running' is always treated as stale.
   * Returns true when a stale running state is detected.
   */
  detectStaleRunning(): Promise<boolean>;
}

export type BootstrapHeartbeatDeps = {
  /** Mongoose model for vault_sync_state — injected for testability. */
  vaultSyncState: Pick<VaultSyncStateModel, 'updateOne' | 'findOne'>;
  /** Heartbeat update interval in milliseconds. */
  intervalMs: number;
  /** Age in milliseconds beyond which a running heartbeat is considered stale. */
  staleThresholdMs: number;
};

/**
 * Factory that creates a BootstrapHeartbeat with explicit dependency injection.
 * All I/O is performed through the injected vaultSyncState model, making the
 * implementation fully testable without a real MongoDB connection.
 */
export function createBootstrapHeartbeat(
  deps: BootstrapHeartbeatDeps,
): BootstrapHeartbeat {
  const { vaultSyncState, intervalMs, staleThresholdMs } = deps;

  // Handle to the running setInterval; null when stopped.
  let intervalHandle: ReturnType<typeof setInterval> | null = null;

  return {
    async acquireInstance() {
      const instanceId = crypto.randomUUID();
      await vaultSyncState.updateOne(
        { _id: 'singleton' },
        {
          $set: {
            bootstrapInstanceId: instanceId,
            bootstrapHeartbeatAt: new Date(),
          },
        },
      );
      return { instanceId };
    },

    refresh() {
      // Guard against double-start: clear any existing interval first.
      if (intervalHandle != null) {
        clearInterval(intervalHandle);
      }
      intervalHandle = setInterval(async () => {
        await vaultSyncState.updateOne(
          { _id: 'singleton' },
          { $set: { bootstrapHeartbeatAt: new Date() } },
        );
      }, intervalMs);
    },

    stop() {
      if (intervalHandle != null) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }
    },

    async detectStaleRunning() {
      const doc = await vaultSyncState.findOne({ _id: 'singleton' }).lean();
      if (doc == null) return false;
      if (doc.bootstrapState !== 'running') return false;
      // Null heartbeat with a running state is treated as always stale.
      if (doc.bootstrapHeartbeatAt == null) return true;
      const staleCutoff = new Date(Date.now() - staleThresholdMs);
      return doc.bootstrapHeartbeatAt < staleCutoff;
    },
  };
}
