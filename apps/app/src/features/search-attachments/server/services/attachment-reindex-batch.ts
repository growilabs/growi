/**
 * AttachmentReindexBatch — rebuilds the attachment ES index in the background.
 *
 * `startRebuild` rebuilds the page index, fills a fresh attachment index,
 * sweeps orphans from it and only then moves the alias onto it, so the live
 * index stays as it was until the swap (see design.md Flow 5).
 *
 * - A failure of one attachment is logged and skipped. A run of failures
 *   that point at an outage (RebuildOutageError) aborts the rebuild instead,
 *   so the alias never moves to an index of empty docs.
 * - NO permission fields stored in any ES document.
 * - Socket events are emitted to the admin namespace so the admin UI can display progress.
 */

import type {
  ExtractionFailureEntry,
  ExtractionOutcome,
  IAttachmentEsDoc,
} from '~/features/search-attachments/interfaces/attachment-search';
import { SocketEventName } from '~/interfaces/websocket';
import type { AttachmentWithComputed } from '~/server/models/attachment';
import type { SocketIoService } from '~/server/service/socket-io/socket-io';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type { AttachmentOrphanSweeper } from './attachment-orphan-sweeper';
import type { AttachmentIndexOperations } from './attachment-search-delegator-extension';
import {
  type AttachmentTextExtractorService,
  FILE_READ_FAILED,
} from './attachment-text-extractor';
import type { ExtractionFailureLogServiceInterface } from './extraction-failure-log-service';
import { indexableAttachments } from './indexable-attachments';

const logger = loggerFactory('growi:service:search-attachments:reindex-batch');

// ---- Public types -----------------------------------------------------------

export interface AttachmentReindexBatchInterface {
  /**
   * Starts the rebuild without waiting for it. Returns false, starting
   * nothing, when a rebuild is already running.
   */
  startRebuild(rebuildPageIndex: () => Promise<void>): boolean;
  isRebuilding(): boolean;
  /** The index being filled, once it exists; live writes go there too. */
  getTmpIndexName(): string | null;
  /** Notes an attachment deleted while a rebuild runs; ignored otherwise. */
  recordDetached(attachmentId: string): void;
}

/** Number of attachment rows fetched from MongoDB per page during a rebuild. */
export const REINDEX_PAGE_SIZE = 100;

/**
 * Failures that say nothing about the file itself: the extractor or the file
 * storage did not answer. One alone is often a single large file (a client
 * timeout, a dropped connection); this many in a row with no success between
 * them is an outage, and every later attachment would fail the same way.
 * The scan is sequential, so waiting for the evidence costs at most this
 * many extraction timeouts.
 */
export const MAX_CONSECUTIVE_OUTAGE_FAILURES = 10;

const isOutageFailure = (outcome: ExtractionOutcome): boolean =>
  outcome.kind === 'serviceUnreachable' ||
  (outcome.kind === 'failed' && outcome.reasonCode === FILE_READ_FAILED);

export class RebuildOutageError extends Error {
  constructor() {
    super(
      `${MAX_CONSECUTIVE_OUTAGE_FAILURES} attachments in a row could not be read or extracted; the extractor or the file storage looks down`,
    );
    this.name = 'RebuildOutageError';
  }
}

// ---- Internal helpers -------------------------------------------------------

/**
 * Fetches up to `take` indexable attachment ids greater than `afterId` (or
 * from the start when null), in ascending order.
 */
export type FetchAttachmentIdPage = (
  afterId: string | null,
  take: number,
) => Promise<string[]>;

// Only ids are paged: Prisma rejects a whole `findMany` result when any single
// row violates the schema, so full rows are loaded one by one inside the
// per-row try/catch and a malformed row can only fail itself.
const fetchAttachmentIdPage: FetchAttachmentIdPage = async (afterId, take) => {
  const rows = await prisma.attachments.findMany({
    select: { id: true },
    where: {
      ...indexableAttachments,
      ...(afterId != null ? { id: { gt: afterId } } : {}),
    },
    orderBy: { id: 'asc' },
    take,
  });
  return rows.map((row) => row.id);
};

/**
 * Yields every attachment id once, in ascending order, one page at a time.
 * Pages by `id > lastId` (keyset) rather than by offset so concurrent
 * inserts/deletes cannot shift rows between pages.
 */
export async function* iterateAllAttachmentIds(
  fetchPage: FetchAttachmentIdPage = fetchAttachmentIdPage,
  pageSize: number = REINDEX_PAGE_SIZE,
): AsyncGenerator<string> {
  let lastId: string | null = null;
  while (true) {
    // biome-ignore lint/performance/noAwaitInLoops: pagination is inherently sequential — each page needs the previous page's last id
    const page = await fetchPage(lastId, pageSize);
    yield* page;
    if (page.length < pageSize) {
      return;
    }
    lastId = page[page.length - 1];
  }
}

/**
 * Maps an ExtractionOutcome.kind to the reasonCode string expected by
 * ExtractionFailureEntry.
 */
function outcomeToReasonCode(
  kind: Exclude<ExtractionOutcome['kind'], 'success'>,
): ExtractionFailureEntry['reasonCode'] {
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
    case 'encrypted':
      return 'fileEncrypted';
    case 'resourceLimit':
      return 'resourceLimitExceeded';
    case 'failed':
      return 'extractionFailed';
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
  attachment: AttachmentWithComputed,
  pageId: string,
  outcome: ExtractionOutcome,
): IAttachmentEsDoc[] {
  const attachmentId = attachment.id;
  const createdAt =
    attachment.createdAt != null
      ? attachment.createdAt.toISOString()
      : new Date().toISOString();
  // Attachments have no updatedAt — use createdAt as fallback
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
 * 1. Paging through every MongoDB Attachment id.
 * 2. Calling the text extractor for each attachment.
 * 3. Writing ES docs via `syncAttachmentIndexed`.
 * 4. Recording failures via `failureLogService`.
 * 5. Emitting socket progress events to the admin namespace.
 */
export class AttachmentReindexBatch implements AttachmentReindexBatchInterface {
  private _isRebuilding = false;
  private _tmpIndexName: string | null = null;
  // The scan may write an attachment into the new index after it was deleted
  private readonly detachedDuringRebuild = new Set<string>();

  private readonly extractor: AttachmentTextExtractorService;
  private readonly delegatorExt: AttachmentIndexOperations;
  private readonly failureLogService: ExtractionFailureLogServiceInterface;
  private readonly orphanSweeper: AttachmentOrphanSweeper;
  private readonly socketIoService: SocketIoService;

  // biome-ignore lint/complexity/useMaxParams: all 5 dependencies are required by the interface contract (task 6.3)
  constructor(
    extractor: AttachmentTextExtractorService,
    delegatorExt: AttachmentIndexOperations,
    failureLogService: ExtractionFailureLogServiceInterface,
    orphanSweeper: AttachmentOrphanSweeper,
    socketIoService: SocketIoService,
  ) {
    this.extractor = extractor;
    this.delegatorExt = delegatorExt;
    this.failureLogService = failureLogService;
    this.orphanSweeper = orphanSweeper;
    this.socketIoService = socketIoService;
  }

  // ---- Lifecycle -------------------------------------------------------------

  startRebuild(rebuildPageIndex: () => Promise<void>): boolean {
    if (this._isRebuilding) {
      return false;
    }
    // Set before any await so a concurrent request sees it
    this._isRebuilding = true;
    void this.rebuild(rebuildPageIndex);
    return true;
  }

  private async rebuild(rebuildPageIndex: () => Promise<void>): Promise<void> {
    try {
      await rebuildPageIndex();

      this._tmpIndexName = await this.delegatorExt.createRebuildIndex();
      const result = await this.addAllAttachments(this._tmpIndexName);
      // Deletions from here on reach the new index through the dual delete
      if (this.detachedDuringRebuild.size > 0) {
        await this.delegatorExt.removeAttachmentsFromIndex(
          [...this.detachedDuringRebuild],
          this._tmpIndexName,
        );
      }
      await this.delegatorExt.swapAttachmentAlias(this._tmpIndexName);

      this.socketIoService
        .getAdminSocket()
        .emit(SocketEventName.FinishAddAttachment, result);
    } catch (err) {
      logger.error({ err }, 'Attachment index rebuild failed');
      this.socketIoService
        .getAdminSocket()
        ?.emit(SocketEventName.AttachmentRebuildingFailed, {
          error: err instanceof Error ? err.message : String(err),
        });
      // Cleared first so no live write re-creates the index being dropped
      const tmpIndexName = this._tmpIndexName;
      this._tmpIndexName = null;
      if (tmpIndexName != null) {
        await this.delegatorExt
          .dropRebuildIndex(tmpIndexName)
          .catch((dropErr) =>
            logger.error(
              { err: dropErr, index: tmpIndexName },
              'Failed to drop the half-built attachment index',
            ),
          );
      }
    } finally {
      this._tmpIndexName = null;
      this.detachedDuringRebuild.clear();
      this._isRebuilding = false;
    }
  }

  recordDetached(attachmentId: string): void {
    if (this._isRebuilding) {
      this.detachedDuringRebuild.add(attachmentId);
    }
  }

  isRebuilding(): boolean {
    return this._isRebuilding;
  }

  getTmpIndexName(): string | null {
    return this._tmpIndexName;
  }

  /**
   * Loads one attachment, extracts its text and upserts its ES docs. Returns
   * the extraction outcome, or null when the attachment was deleted.
   */
  private async indexAttachment(
    attachmentId: string,
    targetIndex: string,
  ): Promise<ExtractionOutcome | null> {
    const attachment = await prisma.attachments.findUnique({
      where: { id: attachmentId },
    });
    // Deleted after its id was paged
    if (attachment?.pageId == null) {
      return null;
    }
    const { pageId } = attachment;

    const outcome = await this.extractor.extractAttachment(attachmentId);
    const docs = buildDocs(attachment, pageId, outcome);

    // Upsert ES docs (success and failure alike get a metadata doc)
    await this.delegatorExt.syncAttachmentIndexed(
      attachmentId,
      pageId,
      docs,
      targetIndex,
    );

    // Record failure for non-success outcomes
    if (outcome.kind !== 'success') {
      const message =
        outcome.kind === 'failed' || outcome.kind === 'resourceLimit'
          ? outcome.message
          : null;
      await this.failureLogService.record({
        attachmentId,
        pageId,
        fileName: attachment.fileName,
        fileFormat: attachment.fileFormat,
        fileSize: attachment.fileSize,
        reasonCode: outcomeToReasonCode(outcome.kind),
        message,
        occurredAt: new Date(),
      });
    }
    return outcome;
  }

  // ---- Bulk indexing ---------------------------------------------------------

  /**
   * Extracts and indexes every attachment into `targetIndex`, then removes
   * docs whose page no longer exists. A failure on one attachment is logged
   * and skipped; a run of outage failures rejects with RebuildOutageError.
   */
  async addAllAttachments(
    targetIndex: string,
  ): Promise<{ totalCount: number; count: number }> {
    const socket = this.socketIoService.getAdminSocket();

    const total = await prisma.attachments.count({
      where: indexableAttachments,
    });
    logger.info(
      { targetIndex, total },
      'addAllAttachments: starting paged walk',
    );

    let processed = 0;
    let consecutiveOutageFailures = 0;
    for await (const attachmentId of iterateAllAttachmentIds()) {
      try {
        const outcome = await this.indexAttachment(attachmentId, targetIndex);
        if (outcome != null) {
          consecutiveOutageFailures = isOutageFailure(outcome)
            ? consecutiveOutageFailures + 1
            : 0;
        }
      } catch (err) {
        logger.error(
          { err, attachmentId },
          'addAllAttachments: skipping attachment due to unexpected error',
        );
      }

      if (consecutiveOutageFailures >= MAX_CONSECUTIVE_OUTAGE_FAILURES) {
        throw new RebuildOutageError();
      }

      processed += 1;
      socket.emit(SocketEventName.AddAttachmentProgress, {
        totalCount: total,
        count: processed,
      });
    }

    const sweepResult = await this.orphanSweeper.sweep(targetIndex);
    logger.info(
      { targetIndex, processed, total, ...sweepResult },
      'addAllAttachments: finished',
    );

    return { totalCount: processed, count: processed };
  }
}
