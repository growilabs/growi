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

import type { VaultInstructionDoc } from '@growi/core/dist/interfaces/vault';

import {
  type IVaultInstructionDocument,
  type VaultChangeStream,
  VaultInstructionModel,
} from '../models/vault-instruction.js';
import { VaultSyncStateModel } from '../models/vault-sync-state.js';
import * as VaultNamespaceBuilder from './vault-namespace-builder.js';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface VaultInstructionWatcher {
  start(): Promise<void>;
  stop(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a VaultInstructionWatcher instance.
 * Call `start()` to begin watching and `stop()` to shut down gracefully.
 */
export function createVaultInstructionWatcher(): VaultInstructionWatcher {
  // Active change stream handle; null when stopped.
  let changeStream: VaultChangeStream | null = null;

  // Resolves when all in-flight processing has completed (set during stop).
  let drainComplete = false;

  // Buffer for change stream events that arrive during the drain phase.
  // Flushed in arrival order once the cursor drain finishes.
  const eventBuffer: IVaultInstructionDocument[] = [];

  // Whether the watcher has been asked to stop.
  let stopping = false;

  // Promise tracking the active processing pipeline so stop() can await it.
  let pipelinePromise: Promise<void> = Promise.resolve();

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
  async function processInstruction(
    doc: IVaultInstructionDocument,
    resumeTokenToSave?: object,
  ): Promise<void> {
    // Idempotency check: skip already-processed instructions.
    if (doc.processedAt != null) {
      return;
    }

    // Cast to VaultInstructionDoc for the builder (drops Mongoose internals).
    const instruction = doc as unknown as VaultInstructionDoc;

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
  async function runDrain(): Promise<void> {
    const cursor = VaultInstructionModel.drainCursor().cursor();

    for await (const doc of cursor) {
      if (stopping) break;
      // During drain we do not have a resume token from the change stream event;
      // we skip saving one so we do not overwrite the token loaded from state.
      await processInstruction(doc as IVaultInstructionDocument);
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
  function attachChangeStreamListener(stream: VaultChangeStream): void {
    // The MongoDB change stream emits typed ChangeStreamDocument objects.
    // We only watch inserts (see VaultInstructionModel.watchInserts), so
    // fullDocument is always present on the event.
    stream.on(
      'change',
      async (event: { fullDocument?: unknown; _id?: unknown }) => {
        if (stopping) return;

        // The fullDocument field carries the inserted MongoDB document.
        // We need to wrap it as a Mongoose document for method access.
        // Since we only watch inserts, fullDocument is always populated.
        if (event.fullDocument == null) return;

        // Look up the live Mongoose document so instance methods are available.
        const rawDoc = event.fullDocument as { _id: unknown };
        const liveDoc = await VaultInstructionModel.findById(rawDoc._id);
        if (liveDoc == null) return;

        const resumeToken = event._id as object | undefined;

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
      },
    );

    stream.on('error', (err: Error) => {
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
    async start(): Promise<void> {
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

    async stop(): Promise<void> {
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
