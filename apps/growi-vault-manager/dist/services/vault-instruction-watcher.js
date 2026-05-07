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
import { VaultInstructionModel } from '../models/vault-instruction.js';
import { VaultSyncStateModel } from '../models/vault-sync-state.js';
import * as VaultNamespaceBuilder from './vault-namespace-builder.js';
// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
/**
 * Creates a VaultInstructionWatcher instance.
 * Call `start()` to begin watching and `stop()` to shut down gracefully.
 */
export function createVaultInstructionWatcher() {
  // Active change stream handle; null when stopped.
  let changeStream = null;
  // Resolves when all in-flight processing has completed (set during stop).
  let drainComplete = false;
  // Buffer for change stream events that arrive during the drain phase.
  // Flushed in arrival order once the cursor drain finishes.
  const eventBuffer = [];
  // Whether the watcher has been asked to stop.
  let stopping = false;
  // Promise tracking the active processing pipeline so stop() can await it.
  let pipelinePromise = Promise.resolve();
  // ---------------------------------------------------------------------------
  // Single-instruction processor (shared by drain and change stream paths)
  // ---------------------------------------------------------------------------
  /**
   * Processes a single instruction document.
   *
   * Idempotency: if processedAt is already set the instruction is skipped.
   * On success: processedAt is written and the resume token is saved (if provided).
   * On failure: attempts++ / lastError recorded; processedAt stays null.
   */
  async function processInstruction(doc, resumeTokenToSave) {
    // Idempotency check: skip already-processed instructions.
    if (doc.processedAt != null) {
      return;
    }
    // Cast to VaultInstructionDoc for the builder (drops Mongoose internals).
    const instruction = doc;
    try {
      await VaultNamespaceBuilder.applyInstruction(instruction);
      // Success: mark as processed.
      await doc.markProcessed();
      // Persist the resume token and update lastProcessedAt atomically.
      await VaultSyncStateModel.updateWatcherFields({
        ...(resumeTokenToSave != null
          ? { resumeToken: resumeTokenToSave }
          : {}),
        lastProcessedAt: new Date(),
      });
    } catch (err) {
      // Failure: record the error; processedAt remains null for retry.
      const errorMessage = err instanceof Error ? err.message : String(err);
      await doc.recordFailure(errorMessage);
    }
  }
  // ---------------------------------------------------------------------------
  // Startup drain
  // ---------------------------------------------------------------------------
  /**
   * Drains all instructions with processedAt: null using a cursor.
   * Processes them sequentially ordered by issuedAt.
   */
  async function runDrain() {
    const cursor = VaultInstructionModel.drainCursor().cursor();
    for await (const doc of cursor) {
      if (stopping) break;
      // During drain we do not have a resume token from the change stream event;
      // we skip saving one so we do not overwrite the token loaded from state.
      await processInstruction(doc);
    }
    drainComplete = true;
    // Flush buffered change stream events that arrived during the drain.
    for (const bufferedDoc of eventBuffer) {
      if (stopping) break;
      await processInstruction(bufferedDoc);
    }
    eventBuffer.length = 0;
  }
  // ---------------------------------------------------------------------------
  // Change stream handler
  // ---------------------------------------------------------------------------
  /**
   * Registers the 'change' listener on the open change stream.
   * Events received during the drain phase are buffered; after drain they
   * are processed immediately.
   */
  function attachChangeStreamListener(stream) {
    // The MongoDB change stream emits typed ChangeStreamDocument objects.
    // We only watch inserts (see VaultInstructionModel.watchInserts), so
    // fullDocument is always present on the event.
    stream.on('change', async (event) => {
      if (stopping) return;
      // The fullDocument field carries the inserted MongoDB document.
      // We need to wrap it as a Mongoose document for method access.
      // Since we only watch inserts, fullDocument is always populated.
      if (event.fullDocument == null) return;
      // Look up the live Mongoose document so instance methods are available.
      const rawDoc = event.fullDocument;
      const liveDoc = await VaultInstructionModel.findById(rawDoc._id);
      if (liveDoc == null) return;
      const resumeToken = event._id;
      if (!drainComplete) {
        // Buffer the event; it will be flushed after drain completes.
        eventBuffer.push(liveDoc);
        return;
      }
      // Drain is done — process immediately and persist the resume token.
      await processInstruction(liveDoc, resumeToken ?? undefined);
      if (resumeToken != null) {
        await VaultSyncStateModel.saveResumeToken(resumeToken);
      }
    });
    stream.on('error', (err) => {
      // Do not throw here — the error listener must not propagate synchronously.
      process.stderr.write(
        `[VaultInstructionWatcher] change stream error: ${err.message}\n`,
      );
    });
  }
  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  return {
    async start() {
      stopping = false;
      drainComplete = false;
      eventBuffer.length = 0;
      // 1. Read the persisted resume token.
      const syncState = await VaultSyncStateModel.getSingleton();
      const resumeToken = syncState?.resumeToken ?? undefined;
      // 2. Open the change stream (with resumeAfter when token is available).
      changeStream = VaultInstructionModel.watchInserts(resumeToken);
      // 3. Attach the listener before drain so no events are missed.
      attachChangeStreamListener(changeStream);
      // 4. Run the startup drain (and flush the event buffer when done).
      pipelinePromise = runDrain();
      await pipelinePromise;
    },
    async stop() {
      stopping = true;
      // Wait for any in-flight drain / processing to complete.
      await pipelinePromise;
      // Close the change stream.
      if (changeStream != null) {
        await changeStream.close();
        changeStream = null;
      }
    },
  };
}
//# sourceMappingURL=vault-instruction-watcher.js.map
