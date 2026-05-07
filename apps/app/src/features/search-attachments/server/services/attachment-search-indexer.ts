/**
 * AttachmentSearchIndexer
 *
 * Orchestrates attachment text extraction and Elasticsearch indexing.
 * Responsibilities:
 * - Guard behind isFeatureEnabled() check
 * - On extraction success: bulk-upsert all extracted pages to ES (NO permission fields)
 * - On extraction failure: upsert a metadata-only doc + record in ExtractionFailureLogService
 * - Dual-write support: when reindexBatch is rebuilding, write to both live and tmp indexes
 * - onDetach: delete all ES docs for a given attachmentId
 * - reindex: synchronous re-extraction + indexing for a single attachment
 *
 * Design guarantee: all public methods are catch-all — they never throw.
 */

import type {
  ExtractionFailureEntry,
  ExtractionOutcome,
  IAttachmentEsDoc,
} from '~/features/search-attachments/interfaces/attachment-search';
import type { IAttachmentDocument } from '~/server/models/attachment';
import { Attachment } from '~/server/models/attachment';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import type { AttachmentIndexOperations } from './attachment-search-delegator-extension';
import type { AttachmentTextExtractorService } from './attachment-text-extractor';
import type { ExtractionFailureLogServiceInterface } from './extraction-failure-log-service';

const logger = loggerFactory('growi:service:search-attachments:indexer');

/** Minimal interface for querying reindex batch state. */
export interface ReindexBatchRef {
  isRebuilding(): boolean;
  getTmpIndexName(): string | null;
}

/** Public contract for AttachmentSearchIndexer. */
export interface AttachmentSearchIndexerInterface {
  onAttach(
    pageId: string | null,
    attachment: IAttachmentDocument,
    file: Express.Multer.File,
  ): Promise<void>;
  onDetach(attachmentId: string): Promise<void>;
  reindex(
    attachmentId: string,
  ): Promise<{ ok: boolean; outcome: ExtractionOutcome }>;
}

// ----------------------------------------------------------------
// Helpers — outcome mapping
// ----------------------------------------------------------------

/**
 * Maps an ExtractionOutcome kind to the reasonCode required by ExtractionFailureEntry.
 */
function outcomeKindToReasonCode(
  outcome: Exclude<ExtractionOutcome, { kind: 'success' }>,
): ExtractionFailureEntry['reasonCode'] {
  switch (outcome.kind) {
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
  }
}

/**
 * Extracts an optional message string from a failure outcome.
 */
function outcomeToMessage(
  outcome: Exclude<ExtractionOutcome, { kind: 'success' }>,
): string | null {
  if (outcome.kind === 'failed') {
    return outcome.message ?? null;
  }
  return null;
}

// ----------------------------------------------------------------
// Doc builders
// ----------------------------------------------------------------

/**
 * Builds the IAttachmentEsDoc array from a successful extraction outcome.
 * NO permission fields (grant/granted_users/granted_groups/creator) are included.
 */
function buildSuccessDocs(
  attachment: IAttachmentDocument,
  pageId: string | null,
  outcome: Extract<ExtractionOutcome, { kind: 'success' }>,
): IAttachmentEsDoc[] {
  const now = new Date().toISOString();
  return outcome.pages.map((p) => ({
    attachmentId: attachment._id.toString(),
    pageId: pageId ?? '',
    pageNumber: p.pageNumber,
    label: p.label,
    fileName: attachment.fileName,
    originalName: attachment.originalName ?? attachment.fileName,
    fileFormat: attachment.fileFormat,
    fileSize: attachment.fileSize,
    attachmentType: attachment.attachmentType ?? 'attachment',
    content: p.content,
    created_at: attachment.createdAt?.toISOString() ?? now,
    updated_at:
      (
        attachment as unknown as { updatedAt?: Date }
      ).updatedAt?.toISOString() ?? now,
  }));
}

/**
 * Builds a single metadata-only IAttachmentEsDoc (content='') for a failure outcome.
 * NO permission fields are included.
 */
function buildFailureDoc(
  attachment: IAttachmentDocument,
  pageId: string | null,
): IAttachmentEsDoc {
  const now = new Date().toISOString();
  return {
    attachmentId: attachment._id.toString(),
    pageId: pageId ?? '',
    pageNumber: null,
    label: null,
    fileName: attachment.fileName,
    originalName: attachment.originalName ?? attachment.fileName,
    fileFormat: attachment.fileFormat,
    fileSize: attachment.fileSize,
    attachmentType: attachment.attachmentType ?? 'attachment',
    content: '',
    created_at: attachment.createdAt?.toISOString() ?? now,
    updated_at:
      (
        attachment as unknown as { updatedAt?: Date }
      ).updatedAt?.toISOString() ?? now,
  };
}

// ----------------------------------------------------------------
// AttachmentSearchIndexer
// ----------------------------------------------------------------

/** Constructor options for AttachmentSearchIndexer. */
export type AttachmentSearchIndexerOptions = {
  extractor: AttachmentTextExtractorService;
  delegatorExt: AttachmentIndexOperations;
  failureLog: ExtractionFailureLogServiceInterface;
  reindexBatch: ReindexBatchRef;
  searchService: { isConfigured: boolean };
};

export class AttachmentSearchIndexer
  implements AttachmentSearchIndexerInterface
{
  private readonly extractor: AttachmentTextExtractorService;
  private readonly delegatorExt: AttachmentIndexOperations;
  private readonly failureLog: ExtractionFailureLogServiceInterface;
  private readonly reindexBatch: ReindexBatchRef;
  private readonly searchService: { isConfigured: boolean };

  constructor(opts: AttachmentSearchIndexerOptions) {
    this.extractor = opts.extractor;
    this.delegatorExt = opts.delegatorExt;
    this.failureLog = opts.failureLog;
    this.reindexBatch = opts.reindexBatch;
    this.searchService = opts.searchService;
  }

  // ----------------------------------------------------------------
  // Feature gate
  // ----------------------------------------------------------------

  /**
   * Returns true when the attachment full-text search indexing feature is ready.
   *
   * All four conditions must hold:
   * 1. The search service is configured (Elasticsearch reachable)
   * 2. A non-empty extractorUri is configured
   * 3. A non-empty extractorToken is configured
   */
  private isFeatureEnabled(): boolean {
    const extractorUri = configManager.getConfig(
      'app:attachmentFullTextSearch:extractorUri',
    ) as string | undefined;

    const extractorToken = configManager.getConfig(
      'app:attachmentFullTextSearch:extractorToken',
    ) as string | undefined;

    return (
      this.searchService.isConfigured &&
      extractorUri != null &&
      extractorUri !== '' &&
      extractorToken != null &&
      extractorToken !== ''
    );
  }

  // ----------------------------------------------------------------
  // Target index resolution (dual-write)
  // ----------------------------------------------------------------

  /**
   * Returns the list of ES index names to write to.
   * When the reindex batch is rebuilding, both the live index and tmp index are included.
   */
  private getTargetIndexes(): string[] {
    const live = 'attachments';
    if (this.reindexBatch.isRebuilding()) {
      const tmp = this.reindexBatch.getTmpIndexName();
      if (tmp != null) {
        return [live, tmp];
      }
    }
    return [live];
  }

  // ----------------------------------------------------------------
  // Core write helper (dual-write aware)
  // ----------------------------------------------------------------

  /**
   * Writes attachment ES docs with dual-write semantics.
   *
   * When multiple indexes are targeted (rebuilding mode):
   * 1. Write to live index first.
   * 2. Attempt write to tmp index — failure is logged as WARN and does not throw.
   *
   * When only live is targeted, a single bulk call is issued.
   */
  private async writeToIndexes(
    attachmentId: string,
    pageId: string | null,
    docs: IAttachmentEsDoc[],
    targetIndexes: string[],
  ): Promise<void> {
    const liveIndex = 'attachments';
    const tmpIndexes = targetIndexes.filter((idx) => idx !== liveIndex);
    const hasLive = targetIndexes.includes(liveIndex);

    // Always write to live first (if present)
    if (hasLive) {
      await this.delegatorExt.syncAttachmentIndexed(
        attachmentId,
        pageId ?? '',
        docs,
        [liveIndex],
      );
    }

    // Write to each tmp index (non-blocking on failure).
    // In practice tmpIndexes has at most one element (one tmp index during rebuild),
    // so we use Promise.allSettled to satisfy the no-await-in-loops rule while still
    // isolating per-index failures.
    if (tmpIndexes.length > 0) {
      const tmpResults = await Promise.allSettled(
        tmpIndexes.map((tmpIndex) =>
          this.delegatorExt.syncAttachmentIndexed(
            attachmentId,
            pageId ?? '',
            docs,
            [tmpIndex],
          ),
        ),
      );
      for (let i = 0; i < tmpResults.length; i++) {
        const result = tmpResults[i];
        if (result.status === 'rejected') {
          logger.warn(
            { err: result.reason, attachmentId, tmpIndex: tmpIndexes[i] },
            'tmp-side write failed, live-side succeeded',
          );
        }
      }
    }
  }

  // ----------------------------------------------------------------
  // Core extraction + indexing logic (shared by onAttach and reindex)
  // ----------------------------------------------------------------

  /**
   * Runs extraction for the attachment and indexes results.
   * Returns the ExtractionOutcome for the caller to surface.
   */
  private async extractAndIndex(
    attachment: IAttachmentDocument,
    pageId: string | null,
  ): Promise<ExtractionOutcome> {
    const attachmentId = attachment._id.toString();
    const targetIndexes = this.getTargetIndexes();

    const outcome = await this.extractor.extractAttachment(attachmentId);

    if (outcome.kind === 'success') {
      const docs = buildSuccessDocs(attachment, pageId, outcome);
      await this.writeToIndexes(attachmentId, pageId, docs, targetIndexes);

      logger.info(
        { attachmentId, pageId, docCount: docs.length },
        'Attachment indexed successfully',
      );
    } else {
      // Failure path: index a metadata-only doc + record the failure
      const fallbackDoc = buildFailureDoc(attachment, pageId);
      await this.writeToIndexes(
        attachmentId,
        pageId,
        [fallbackDoc],
        targetIndexes,
      );

      const failureEntry: ExtractionFailureEntry = {
        attachmentId,
        pageId: pageId ?? null,
        fileName: attachment.fileName,
        fileFormat: attachment.fileFormat,
        fileSize: attachment.fileSize,
        reasonCode: outcomeKindToReasonCode(outcome),
        message: outcomeToMessage(outcome),
        occurredAt: new Date(),
      };

      await this.failureLog.record(failureEntry);

      logger.info(
        { attachmentId, pageId, kind: outcome.kind },
        'Attachment indexing recorded with failure outcome',
      );
    }

    return outcome;
  }

  // ----------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------

  /**
   * Called when an attachment is attached to a page.
   * Fire-and-forget safe — never throws.
   */
  async onAttach(
    pageId: string | null,
    attachment: IAttachmentDocument,
    _file: Express.Multer.File,
  ): Promise<void> {
    try {
      if (!this.isFeatureEnabled()) {
        logger.debug(
          { attachmentId: attachment._id?.toString() },
          'onAttach: feature disabled, skipping indexing',
        );
        return;
      }

      await this.extractAndIndex(attachment, pageId);
    } catch (err) {
      logger.error(
        { err, attachmentId: attachment._id?.toString(), pageId },
        'onAttach: unexpected error during attachment indexing',
      );
    }
  }

  /**
   * Called when an attachment is detached/deleted.
   * Removes all ES documents for the attachment from all target indexes.
   * Never throws.
   */
  async onDetach(attachmentId: string): Promise<void> {
    try {
      const targetIndexes = this.getTargetIndexes();

      // Attempt live first, then tmp (best-effort for each)
      const liveIndex = 'attachments';
      const tmpIndexes = targetIndexes.filter((idx) => idx !== liveIndex);

      if (targetIndexes.includes(liveIndex)) {
        try {
          await this.delegatorExt.syncAttachmentRemoved(attachmentId, [
            liveIndex,
          ]);
        } catch (err) {
          logger.error(
            { err, attachmentId, index: liveIndex },
            'onDetach: failed to remove from live index',
          );
        }
      }

      // Remove from tmp indexes (non-blocking per index).
      // In practice at most one tmp index exists during rebuild.
      if (tmpIndexes.length > 0) {
        const tmpResults = await Promise.allSettled(
          tmpIndexes.map((tmpIndex) =>
            this.delegatorExt.syncAttachmentRemoved(attachmentId, [tmpIndex]),
          ),
        );
        for (let i = 0; i < tmpResults.length; i++) {
          const result = tmpResults[i];
          if (result.status === 'rejected') {
            logger.warn(
              { err: result.reason, attachmentId, index: tmpIndexes[i] },
              'onDetach: failed to remove from tmp index (non-blocking)',
            );
          }
        }
      }
    } catch (err) {
      logger.error(
        { err, attachmentId },
        'onDetach: unexpected error during attachment removal',
      );
    }
  }

  /**
   * Synchronously re-extracts and re-indexes a single attachment.
   * Returns `{ ok: false }` if the attachment is not found in MongoDB.
   * Never throws — all errors are caught and returned as `{ ok: false }`.
   */
  async reindex(
    attachmentId: string,
  ): Promise<{ ok: boolean; outcome: ExtractionOutcome }> {
    try {
      if (!this.isFeatureEnabled()) {
        logger.debug({ attachmentId }, 'reindex: feature disabled, skipping');
        return { ok: false, outcome: { kind: 'serviceUnreachable' } };
      }

      const attachment = await Attachment.findById(attachmentId);
      if (attachment == null) {
        logger.warn(
          { attachmentId },
          'reindex: attachment not found in MongoDB',
        );
        return { ok: false, outcome: { kind: 'serviceUnreachable' } };
      }

      const pageId =
        attachment.page != null ? attachment.page.toString() : null;

      const outcome = await this.extractAndIndex(attachment, pageId);

      return { ok: true, outcome };
    } catch (err) {
      logger.error({ err, attachmentId }, 'reindex: unexpected error');
      return { ok: false, outcome: { kind: 'serviceUnreachable' } };
    }
  }
}
