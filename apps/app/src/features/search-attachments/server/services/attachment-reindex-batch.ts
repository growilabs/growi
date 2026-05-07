/**
 * AttachmentReindexBatch — orchestrates a full rebuild of the attachment ES index.
 *
 * Lifecycle (managed by the API route, task 8.6):
 *   1. API route calls `begin(tmpIndexName)` → sets rebuilding flag
 *   2. API route calls `addAllAttachments(tmpIndexName, progress)` → streams MongoDB cursor
 *   3. API route calls `end()` → clears flag
 *
 * Design constraints:
 * - Individual attachment extraction failures NEVER abort the batch — log + continue.
 * - NO permission fields stored in any ES document.
 * - Socket events are emitted to the admin namespace so the admin UI can display progress.
 * - Sweep (orphan cleanup) happens after bulk indexing but BEFORE alias swap (alias swap
 *   is performed by the API route after `addAllAttachments` resolves).
 */

import type { IAttachment } from '@growi/core';

import type {
  ExtractionFailureEntry,
  ExtractionOutcome,
  IAttachmentEsDoc,
} from '~/features/search-attachments/interfaces/attachment-search';
import { SocketEventName } from '~/interfaces/websocket';
import { Attachment } from '~/server/models/attachment';
import type { SocketIoService } from '~/server/service/socket-io/socket-io';
import loggerFactory from '~/utils/logger';

import type { AttachmentOrphanSweeper } from './attachment-orphan-sweeper';
import type { AttachmentIndexOperations } from './attachment-search-delegator-extension';
import type { AttachmentTextExtractorService } from './attachment-text-extractor';
import type { ExtractionFailureLogServiceInterface } from './extraction-failure-log-service';

const logger = loggerFactory('growi:service:search-attachments:reindex-batch');

// ---- Public types -----------------------------------------------------------

/** Callback invoked after each attachment is processed (success or failure). */
export type ProgressCallback = (processed: number, total: number) => void;

export interface AttachmentReindexBatchInterface {
  addAllAttachments(
    targetIndex: string,
    progress: ProgressCallback,
  ): Promise<void>;
  /** Begins a rebuild session. Throws a 409 error if a rebuild is already running. */
  begin(tmpIndexName: string): void;
  /** Ends the current rebuild session, clearing in-memory state. */
  end(): void;
  isRebuilding(): boolean;
  getTmpIndexName(): string | null;
}

// ---- Internal helpers -------------------------------------------------------

/**
 * Maps an ExtractionOutcome.kind to the reasonCode string expected by
 * ExtractionFailureEntry. Returns null for the 'success' kind (not a failure).
 */
function outcomeToReasonCode(
  kind: ExtractionOutcome['kind'],
): ExtractionFailureEntry['reasonCode'] | null {
  switch (kind) {
    case 'unsupported':
      return 'unsupportedFormat';
    case 'tooLarge':
      return 'fileTooLarge';
    case 'timeout':
      return 'extractionTimeout';
    case 'serviceBusy':
      return 'serviceBusy';
    case 'serviceUnreachable':
      return 'serviceUnreachable';
    case 'failed':
      return 'extractionFailed';
    default:
      return null;
  }
}

/**
 * Converts an extraction outcome (success or failure) into one or more
 * IAttachmentEsDoc objects.
 *
 * On success: one doc per extracted page, each carrying its content.
 * On failure: a single metadata-only doc with an empty content string.
 *
 * NO permission fields are included in any returned doc.
 */
function buildDocs(
  attachment: IAttachment & { _id: { toString(): string } },
  outcome: ExtractionOutcome,
): IAttachmentEsDoc[] {
  const attachmentId = attachment._id.toString();
  const pageId = attachment.page != null ? String(attachment.page) : '';
  const createdAt =
    attachment.createdAt != null
      ? attachment.createdAt.toISOString()
      : new Date().toISOString();
  // IAttachment has no updatedAt — use createdAt as fallback
  const updatedAt = createdAt;

  const baseFields = {
    attachmentId,
    pageId,
    fileName: attachment.fileName,
    originalName: attachment.originalName ?? attachment.fileName,
    fileFormat: attachment.fileFormat,
    fileSize: attachment.fileSize,
    attachmentType: attachment.attachmentType ?? 'attachment',
    created_at: createdAt,
    updated_at: updatedAt,
  };

  if (outcome.kind === 'success') {
    return outcome.pages.map((p) => ({
      ...baseFields,
      pageNumber: p.pageNumber,
      label: p.label,
      content: p.content,
    }));
  }

  // Failure (any kind) → metadata-only doc
  return [
    {
      ...baseFields,
      pageNumber: null,
      label: null,
      content: '',
    },
  ];
}

// ---- Implementation ---------------------------------------------------------

/**
 * Orchestrates a full rebuild of the attachment ES index by:
 * 1. Walking the full MongoDB Attachment cursor.
 * 2. Calling the text extractor for each attachment.
 * 3. Writing ES docs via `syncAttachmentIndexed`.
 * 4. Recording failures via `failureLogService`.
 * 5. Emitting socket progress events to the admin namespace.
 */
export class AttachmentReindexBatch implements AttachmentReindexBatchInterface {
  private _isRebuilding = false;
  private _tmpIndexName: string | null = null;

  // biome-ignore lint/complexity/useMaxParams: all 5 dependencies are required by the interface contract (task 6.3)
  constructor(
    private readonly extractor: AttachmentTextExtractorService,
    private readonly delegatorExt: AttachmentIndexOperations,
    private readonly failureLogService: ExtractionFailureLogServiceInterface,
    private readonly orphanSweeper: AttachmentOrphanSweeper,
    private readonly socketIoService: SocketIoService,
  ) {}

  // ---- Lifecycle state -------------------------------------------------------

  /**
   * Marks the start of a rebuild run and records the temporary index name.
   * Throws a 409-status error if a rebuild is already in progress.
   */
  begin(tmpIndexName: string): void {
    if (this._isRebuilding) {
      throw Object.assign(new Error('Rebuild already in progress'), {
        status: 409,
      });
    }
    this._isRebuilding = true;
    this._tmpIndexName = tmpIndexName;
  }

  /**
   * Marks the end of a rebuild run and clears in-memory state.
   * Safe to call even if `begin` was never called.
   */
  end(): void {
    this._isRebuilding = false;
    this._tmpIndexName = null;
  }

  isRebuilding(): boolean {
    return this._isRebuilding;
  }

  getTmpIndexName(): string | null {
    return this._tmpIndexName;
  }

  // ---- Bulk indexing ---------------------------------------------------------

  /**
   * Iterates every Attachment document in MongoDB, extracts text, and upserts
   * ES docs into `targetIndex`.
   *
   * Algorithm:
   * 1. Drop and recreate `targetIndex` (idempotent fresh start).
   * 2. Walk the cursor — for each attachment:
   *    a. Call extractor.
   *    b. On success: build docs → `syncAttachmentIndexed`.
   *    c. On failure: build metadata-only doc → `syncAttachmentIndexed` +
   *       `failureLogService.record`. Log and continue.
   *    d. Emit `AddAttachmentProgress` socket event.
   *    e. Call the `progress` callback.
   * 3. Run orphan sweep on `targetIndex` after all docs are processed.
   * 4. Emit `FinishAddAttachment` socket event.
   *
   * On unrecoverable error: emit `RebuildingFailed` then rethrow.
   *
   * Individual attachment failures NEVER abort the batch.
   */
  async addAllAttachments(
    targetIndex: string,
    progress: ProgressCallback,
  ): Promise<void> {
    const socket = this.socketIoService.getAdminSocket();

    try {
      // Step 1: Fresh index (drop if exists, then create)
      await this.delegatorExt.createAttachmentIndex(targetIndex);

      // Step 2: Count total for progress reporting
      const total = await Attachment.countDocuments();

      logger.info(
        { targetIndex, total },
        'addAllAttachments: starting cursor walk',
      );

      let processed = 0;

      // Step 3: Walk MongoDB cursor
      const cursor = Attachment.find().lean().cursor();

      for await (const rawDoc of cursor) {
        const attachment = rawDoc as unknown as IAttachment & {
          _id: { toString(): string };
        };
        const attachmentId = attachment._id.toString();

        try {
          const outcome = await this.extractor.extractAttachment(attachmentId);
          const docs = buildDocs(attachment, outcome);

          // Upsert ES docs (success and failure alike get a metadata doc)
          await this.delegatorExt.syncAttachmentIndexed(
            attachmentId,
            docs[0]?.pageId ?? '',
            docs,
            [targetIndex],
          );

          // Record failure for non-success outcomes
          if (outcome.kind !== 'success') {
            const reasonCode = outcomeToReasonCode(outcome.kind);
            if (reasonCode != null) {
              const message =
                outcome.kind === 'failed' ? outcome.message : null;
              await this.failureLogService.record({
                attachmentId,
                pageId:
                  attachment.page != null ? String(attachment.page) : null,
                fileName: attachment.fileName,
                fileFormat: attachment.fileFormat,
                fileSize: attachment.fileSize,
                reasonCode,
                message,
                occurredAt: new Date(),
              });
            }
          }
        } catch (err) {
          // Individual failure — log and continue
          logger.error(
            { err, attachmentId },
            'addAllAttachments: skipping attachment due to unexpected error',
          );
        }

        processed += 1;
        progress(processed, total);

        socket.emit(SocketEventName.AddAttachmentProgress, {
          totalCount: total,
          count: processed,
        });

        logger.debug(
          { attachmentId, processed, total },
          'addAllAttachments: processed attachment',
        );
      }

      // Step 4: Orphan sweep (after all docs indexed, before alias swap)
      const sweepResult = await this.orphanSweeper.sweep(targetIndex);
      logger.info(
        { targetIndex, ...sweepResult },
        'addAllAttachments: orphan sweep complete',
      );

      // Step 5: Done
      logger.info(
        { targetIndex, processed, total },
        'addAllAttachments: finished',
      );

      socket.emit(SocketEventName.FinishAddAttachment, {
        totalCount: processed,
        count: processed,
      });
    } catch (err) {
      logger.error(
        { err, targetIndex },
        'addAllAttachments: fatal error during batch indexing',
      );

      socket.emit(SocketEventName.RebuildingFailed, {
        error: (err as Error).message,
      });

      throw err;
    }
  }
}
