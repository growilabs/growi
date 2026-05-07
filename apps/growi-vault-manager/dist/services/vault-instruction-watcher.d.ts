/**
 * VaultInstructionWatcher
 *
 * Subscribes to the vault_instructions collection via a MongoDB change stream
 * and processes instructions idempotently.
 *
 * Startup sequence:
 *  1. Read resumeToken from vault_sync_state.
 *  2. Open the change stream (with resumeAfter when a token is available).
 *  3. Drain all unprocessed instructions (processedAt: null) using a cursor.
 *  4. After drain, begin processing buffered and incoming change stream events.
 *
 * At-least-once delivery guarantee:
 *  - On success: processedAt is set and the resume token is persisted.
 *  - On failure: attempts is incremented, lastError is recorded,
 *                processedAt remains null so the instruction is retried
 *                on the next drain or change stream re-delivery.
 */
export interface VaultInstructionWatcher {
  start(): Promise<void>;
  stop(): Promise<void>;
}
/**
 * Creates a VaultInstructionWatcher instance.
 * Call `start()` to begin watching and `stop()` to shut down gracefully.
 */
export declare function createVaultInstructionWatcher(): VaultInstructionWatcher;
