import type { ExtractionFailureEntry } from '~/features/search-attachments/interfaces/attachment-search';
import loggerFactory from '~/utils/logger';

import { ExtractionFailureLog } from '../models/extraction-failure-log';

const logger = loggerFactory(
  'growi:service:search-attachments:extraction-failure-log',
);

/**
 * Duration within which the same (attachmentId + reasonCode) pair is considered
 * a duplicate and suppressed to prevent log flooding.
 */
const DEDUP_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export interface ExtractionFailureLogServiceInterface {
  record(entry: ExtractionFailureEntry): Promise<void>;
  listRecent(options: {
    limit: number;
    since?: Date;
  }): Promise<ExtractionFailureEntry[]>;
  totalRecent(since?: Date): Promise<number>;
}

/**
 * Computes a deterministic group key for deduplication.
 * Two failures with the same attachmentId and reasonCode are considered
 * the same logical failure event within a time window.
 */
function buildRetentionGroupHash(
  attachmentId: string,
  reasonCode: string,
): string {
  return `${attachmentId}:${reasonCode}`;
}

/**
 * Maps a MongoDB document to the public ExtractionFailureEntry DTO.
 */
function docToEntry(doc: {
  attachmentId: string;
  pageId: string | null;
  fileName: string;
  fileFormat: string;
  fileSize: number;
  reasonCode: string;
  message: string | null;
  occurredAt: Date;
}): ExtractionFailureEntry {
  return {
    attachmentId: doc.attachmentId,
    pageId: doc.pageId,
    fileName: doc.fileName,
    fileFormat: doc.fileFormat,
    fileSize: doc.fileSize,
    reasonCode: doc.reasonCode as ExtractionFailureEntry['reasonCode'],
    message: doc.message,
    occurredAt: doc.occurredAt,
  };
}

/**
 * Service responsible for persisting and querying attachment extraction failure logs.
 *
 * Design guarantees:
 * - Dual-path recording: structured pino log at ERROR level + MongoDB persistence
 * - Deduplication: same (attachmentId, reasonCode) within DEDUP_WINDOW_MS is suppressed
 *   to prevent flooding — only `occurredAt` is refreshed on an existing recent record
 * - Never throws: all errors are caught and logged; callers are always safe to fire-and-forget
 */
export class ExtractionFailureLogService
  implements ExtractionFailureLogServiceInterface
{
  /**
   * Records an extraction failure via structured log AND MongoDB persistence.
   * Duplicate entries (same attachmentId + reasonCode within 1 hour) are suppressed:
   * the existing document's `occurredAt` is updated rather than inserting a new one.
   */
  async record(entry: ExtractionFailureEntry): Promise<void> {
    // --- Dual path 1: structured pino log ---
    logger.error(
      {
        attachmentId: entry.attachmentId,
        pageId: entry.pageId,
        fileName: entry.fileName,
        fileFormat: entry.fileFormat,
        fileSize: entry.fileSize,
        reasonCode: entry.reasonCode,
        message: entry.message,
        occurredAt: entry.occurredAt,
      },
      'Attachment text extraction failed',
    );

    // --- Dual path 2: MongoDB persistence with deduplication ---
    try {
      const retentionGroupHash = buildRetentionGroupHash(
        entry.attachmentId,
        entry.reasonCode,
      );
      const dedupWindowStart = new Date(Date.now() - DEDUP_WINDOW_MS);

      await ExtractionFailureLog.findOneAndUpdate(
        {
          retentionGroupHash,
          occurredAt: { $gte: dedupWindowStart },
        },
        {
          $set: { occurredAt: entry.occurredAt },
          $setOnInsert: {
            attachmentId: entry.attachmentId,
            pageId: entry.pageId ?? null,
            fileName: entry.fileName,
            fileFormat: entry.fileFormat,
            fileSize: entry.fileSize,
            reasonCode: entry.reasonCode,
            message: entry.message ?? null,
            retentionGroupHash,
          },
        },
        {
          upsert: true,
          new: false,
        },
      );
    } catch (error) {
      // MongoDB errors must not propagate — this is a best-effort persistence layer
      logger.error(
        { error, attachmentId: entry.attachmentId },
        'Failed to persist extraction failure log to MongoDB',
      );
    }
  }

  /**
   * Returns recent failure log entries, optionally filtered to those occurring
   * on or after `since`, sorted by most recent first.
   */
  async listRecent(options: {
    limit: number;
    since?: Date;
  }): Promise<ExtractionFailureEntry[]> {
    try {
      const filter: Record<string, unknown> = {};
      if (options.since != null) {
        filter.occurredAt = { $gte: options.since };
      }

      const docs = await ExtractionFailureLog.find(filter)
        .sort({ occurredAt: -1 })
        .limit(options.limit)
        .lean();

      return docs.map(docToEntry);
    } catch (error) {
      logger.error({ error }, 'Failed to list recent extraction failure logs');
      return [];
    }
  }

  /**
   * Returns the count of failure log entries occurring on or after `since`.
   * If `since` is omitted, counts all documents in the collection.
   */
  async totalRecent(since?: Date): Promise<number> {
    try {
      const filter: Record<string, unknown> = {};
      if (since != null) {
        filter.occurredAt = { $gte: since };
      }
      return await ExtractionFailureLog.countDocuments(filter);
    } catch (error) {
      logger.error({ error }, 'Failed to count recent extraction failure logs');
      return 0;
    }
  }
}
