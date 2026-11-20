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
import { loggerFactory } from '@growi/logger';

import {
  type IVaultInstructionDocument,
  type VaultChangeStream,
  VaultInstructionModel,
} from '../models/vault-instruction.js';
import { VaultSyncStateModel } from '../models/vault-sync-state.js';
import * as VaultNamespaceBuilder from './vault-namespace-builder.js';

const logger = loggerFactory('growi:vault-manager:vault-instruction-watcher');

// Number of attempts after which an instruction is considered dead-lettered.
const DEAD_LETTER_THRESHOLD = 5;

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
   *
   * Returns an outcome tag so callers (drain) can aggregate counts.
   */
  type InstructionOutcome = 'processed' | 'skipped' | 'failed';

  async function processInstruction(
    doc: IVaultInstructionDocument,
    resumeTokenToSave?: object,
  ): Promise<InstructionOutcome> {
    // Idempotency check: skip already-processed instructions.
    if (doc.processedAt != null) {
      return 'skipped';
    }

    // Build a plain VaultInstructionDoc view from the Mongoose document.
    // _id is stringified at this boundary because Mongoose stores it as ObjectId
    // while VaultInstructionDoc declares it as string.
    const instruction: VaultInstructionDoc = {
      _id: String(doc._id),
      op: doc.op,
      payload: doc.payload,
      issuedAt: doc.issuedAt,
      processedAt: doc.processedAt,
      attempts: doc.attempts,
      lastError: doc.lastError,
    };

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
      return 'processed';
    } catch (err) {
      // Failure: record the error; processedAt remains null for retry.
      const errorMessage = err instanceof Error ? err.message : String(err);
      await doc.recordFailure(errorMessage);

      const attemptsAfter = (doc.attempts ?? 0) + 1;
      const failurePayload = {
        instructionId: instruction._id,
        op: instruction.op,
        attempts: attemptsAfter,
        lastError: errorMessage,
      };

      // Per-failure DEBUG log: visible only when debug logging is enabled.
      // Suppressed by default in production so retries don't flood logs, but
      // available for diagnosing transient failures that haven't yet reached
      // the dead-letter threshold.
      logger.debug(
        failurePayload,
        'vault-instruction-watcher: instruction processing failed',
      );

      // Dead-letter ERROR: emitted only at the exact moment attempts reaches
      // the threshold. Using === (not >=) prevents log flooding when the
      // instruction continues to be retried beyond the threshold.
      if (attemptsAfter === DEAD_LETTER_THRESHOLD) {
        logger.error(
          failurePayload,
          'vault-instruction-watcher: instruction reached dead-letter threshold',
        );
      }
      return 'failed';
    }
  }

  // ---------------------------------------------------------------------------
  // Startup drain
  // ---------------------------------------------------------------------------

  /**
   * Drains all instructions with processedAt: null using a cursor.
   * Processes them sequentially ordered by issuedAt.
   *
   * Emits a single INFO summary log on completion so operators can observe
   * the drain result without inspecting MongoDB. Idempotent-skip outcomes
   * (already-processed docs encountered on retry paths) are excluded from
   * the counts — only fresh work performed in this drain is reported.
   */
  async function runDrain(): Promise<void> {
    const startedAt = Date.now();
    let processed = 0;
    let failed = 0;

    const tally = (outcome: InstructionOutcome): void => {
      if (outcome === 'processed') processed += 1;
      else if (outcome === 'failed') failed += 1;
    };

    const cursor = VaultInstructionModel.drainCursor().cursor();

    for await (const doc of cursor) {
      if (stopping) break;
      // During drain we do not have a resume token from the change stream event;
      // we skip saving one so we do not overwrite the token loaded from state.
      tally(await processInstruction(doc as IVaultInstructionDocument));
    }

    drainComplete = true;

    // Flush buffered change stream events that arrived during the drain.
    for (const bufferedDoc of eventBuffer) {
      if (stopping) break;
      // biome-ignore lint/performance/noAwaitInLoops: instructions must be processed in arrival order to preserve causal ordering
      tally(await processInstruction(bufferedDoc));
    }
    eventBuffer.length = 0;

    logger.info(
      {
        processed,
        failed,
        durationMs: Date.now() - startedAt,
      },
      'vault-instruction-watcher: drain complete',
    );
  }

  // ---------------------------------------------------------------------------
  // Change stream handler
  // ---------------------------------------------------------------------------

  /**
   * Registers the 'change' listener on the open change stream.
   * Events received during the drain phase are buffered; after drain they
   * are processed immediately.
   */
  /**
   * Handles a single change stream event: resolves the live document and
   * applies it (or buffers it while the drain is still running).
   */
  async function handleChangeEvent(event: {
    fullDocument?: unknown;
    _id?: unknown;
  }): Promise<void> {
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

    // Drain is done — process and persist the resume token.
    await processInstruction(liveDoc, resumeToken ?? undefined);

    if (resumeToken != null) {
      await VaultSyncStateModel.saveResumeToken(resumeToken);
    }
  }

  function attachChangeStreamListener(stream: VaultChangeStream): void {
    // The MongoDB change stream emits typed ChangeStreamDocument objects.
    // We only watch inserts (see VaultInstructionModel.watchInserts), so
    // fullDocument is always present on the event.
    stream.on('change', (event: { fullDocument?: unknown; _id?: unknown }) => {
      if (stopping) return;

      // Chain each event synchronously (at arrival time) onto the single
      // processing pipeline. This serializes instruction application — they
      // are applied one at a time, in arrival order, after the startup drain.
      //
      // Serialization is REQUIRED for correctness, not just ordering:
      // applyInstruction → commitAndUpdateRef performs a read-parent →
      // writeCommit → updateRef sequence with no compare-and-swap. Two
      // instructions on the same namespace applied concurrently would both
      // read the same parent commit and the last updateRef would win — losing
      // one update. A single-page rename emits remove(oldPath) + upsert(newPath)
      // on the same namespace, so without serialization the remove is lost and
      // the old file is left orphaned in the cloned repo.
      pipelinePromise = pipelinePromise
        .then(() => handleChangeEvent(event))
        .catch((err: unknown) => {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            'vault-instruction-watcher: change event processing error',
          );
        });
    });

    stream.on('error', (err: Error) => {
      // Do not throw here — the error listener must not propagate synchronously.
      logger.error(
        { changeStreamError: err.message },
        'vault-instruction-watcher: change stream error',
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
