import type {
  ChangeStream,
  ChangeStreamDocument,
  ChangeStreamOptions,
} from 'mongodb';
import mongoose from 'mongoose';

import type { ActivityDocument } from '~/server/models/activity';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import type { AuditlogEsWriter } from '../interfaces/auditlog-es-writer';
import { AuditlogEsSyncStatus } from '../models/auditlog-es-sync-status';
import { ChangeStreamResumeToken } from '../models/changestream-resume-token';

const logger = loggerFactory('growi:service:auditlog-changestream');

// Shared across all instances. Since the token is only saved after a successful ES write,
// token N in the store guarantees event N is already in ES — conflicts cause extra reprocessing but not data loss.
const STREAM_KEY = 'auditlogs';

const CHANGE_STREAM_HISTORY_LOST_CODE = 286;

const isChangeStreamHistoryLost = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false;
  if ('code' in err && err.code === CHANGE_STREAM_HISTORY_LOST_CODE)
    return true;
  // Message text may change between server versions; fallback for errors that lack the code.
  if (err.message.includes('Resume of change stream was not possible'))
    return true;
  return false;
};

export class AuditlogChangeStreamService {
  // Backoff: 1,2,4,8,16,30,30s. Skip a repeatedly failing batch on its 8th failure (~91s total).
  private static readonly MAX_CONSECUTIVE_EVENT_FAILURES = 8;
  private static readonly RESTART_BASE_DELAY_MS = 1000;
  private static readonly RESTART_MAX_DELAY_MS = 30000;
  // Flush a batch once it reaches this size or after this idle gap, whichever comes first.
  private static readonly BATCH_SIZE = 100;
  private static readonly FLUSH_IDLE_MS = 200;

  private readonly esWriter: AuditlogEsWriter;

  private changeStream: ChangeStream<ActivityDocument> | null = null;

  private buffer: ChangeStreamDocument<ActivityDocument>[] = [];

  private stopped = false;

  private restarting = false;

  // Same-token failures, for poison pill detection. Not used for backoff.
  private consecutiveEventFailures = 0;

  // Restarts without forward progress, for backoff. Reset when the resume token advances.
  private consecutiveRestarts = 0;

  private lastFailingToken: unknown = null;

  constructor(esWriter: AuditlogEsWriter) {
    this.esWriter = esWriter;
  }

  async start(): Promise<void> {
    // close() is terminal: once stopped, the service never restarts.
    // Resetting the flag here would let an in-flight restart() reopen the stream after shutdown.
    if (this.stopped) return;

    const auditLogEnabled = configManager.getConfig('app:auditLogEnabled');
    if (!auditLogEnabled) {
      logger.debug(
        'AuditlogChangeStreamService not started: auditLogEnabled is false.',
      );
      return;
    }

    const Activity = mongoose.model<ActivityDocument>('Activity');
    const token = await ChangeStreamResumeToken.load(STREAM_KEY);
    if (this.stopped) return;

    const options: ChangeStreamOptions =
      token != null ? { resumeAfter: token } : {};

    // Requires an open Mongo connection (Crowi awaits setupDatabase() before
    // SearchService.create()). A sync throw here means broken boot order, not a retryable error.
    this.changeStream = Activity.watch<ActivityDocument>([], options);

    void this.processChangeStream();

    logger.info('AuditlogChangeStreamService started.');
  }

  // Retry the initial start like a runtime error, so a transient failure doesn't leave sync dead.
  async startWithRetry(): Promise<void> {
    try {
      await this.start();
    } catch (err) {
      logger.error(
        err,
        'AuditlogChangeStreamService failed initial start; scheduling restart.',
      );
      void this.restart();
    }
  }

  private async processChangeStream(): Promise<void> {
    const changeStream = this.changeStream;
    if (changeStream == null) return;

    try {
      // Keep exactly one in-flight next() in `pending`. flushBuffer() is awaited inline so the
      // loop applies natural backpressure and never runs concurrently with a flush.
      let pending = changeStream.next();

      while (!changeStream.closed) {
        // biome-ignore lint/performance/noAwaitInLoops: change-stream consumption is inherently sequential (backpressure).
        const { idle, event } = await this.nextOrIdle(pending);

        if (idle) {
          if (!(await this.flushBuffer())) break;
          continue;
        }
        if (event == null) break; // stream ended

        pending = changeStream.next();
        this.buffer.push(event);
        if (
          this.buffer.length >= AuditlogChangeStreamService.BATCH_SIZE &&
          !(await this.flushBuffer())
        ) {
          break;
        }
      }

      // Drain events buffered when the stream ended before a size/idle flush.
      // A no-op after an in-loop flush failure, which already emptied the buffer.
      await this.flushBuffer();
    } catch (err) {
      if (isChangeStreamHistoryLost(err)) {
        logger.warn(
          'Change stream history lost (oplog truncated). Clearing resume token and restarting from current position.' +
            ' Documents written during the gap are not in Elasticsearch; run reindex to restore consistency.',
        );
        try {
          await ChangeStreamResumeToken.clear(STREAM_KEY);
        } catch (clearErr) {
          // If clear fails, restart would re-read the stale token and immediately hit HistoryLost again.
          // Stop the service instead; admin must resolve the MongoDB issue and restart the process.
          logger.error(
            clearErr,
            'Failed to clear resume token after history loss. Stopping service to prevent restart loop.',
          );
          this.stopped = true;
        }
        await AuditlogEsSyncStatus.setUnsynced(true);
      } else if (this.stopped) {
        logger.debug('AuditlogChangeStreamService change stream closed.');
      } else {
        logger.error(err, 'AuditlogChangeStreamService change stream error.');
      }
    }

    if (!this.stopped) {
      await this.restart();
    }
  }

  // Resolve with the next event, or { idle: true } if no event arrives within FLUSH_IDLE_MS
  // while the buffer is non-empty. `pending` is never abandoned, so racing it here is lossless.
  private async nextOrIdle(
    pending: Promise<ChangeStreamDocument<ActivityDocument> | null>,
  ): Promise<{
    idle: boolean;
    event: ChangeStreamDocument<ActivityDocument> | null;
  }> {
    if (this.buffer.length === 0) {
      return { idle: false, event: await pending };
    }
    let timer: NodeJS.Timeout | undefined;
    const idle = new Promise<'idle'>((resolve) => {
      timer = setTimeout(
        () => resolve('idle'),
        AuditlogChangeStreamService.FLUSH_IDLE_MS,
      );
    });
    try {
      const result = await Promise.race([pending, idle]);
      return result === 'idle'
        ? { idle: true, event: null }
        : { idle: false, event: result };
    } finally {
      if (timer != null) clearTimeout(timer);
    }
  }

  // Send the buffered events as one ES bulk and persist the resume token at the batch
  // boundary. Returns false when the batch failed (token not advanced) and the stream must
  // restart to replay it; true when synced, poison-pill-skipped, or empty.
  private async flushBuffer(): Promise<boolean> {
    if (this.buffer.length === 0) return true;
    const batch = this.buffer;
    this.buffer = [];

    const upserts: ActivityDocument[] = [];
    const deleteIds: mongoose.Types.ObjectId[] = [];
    for (const event of batch) {
      // 'update' is intentionally ignored: it changes only `action`, which is not in ES.
      if (
        event.operationType === 'insert' &&
        'fullDocument' in event &&
        event.fullDocument != null
      ) {
        upserts.push(event.fullDocument);
      } else if (event.operationType === 'delete') {
        deleteIds.push(event.documentKey._id);
      }
    }
    // Counter keys on the head token: stable across restarts, unlike the drifting tail.
    const firstToken = batch[0]._id;
    const lastToken = batch[batch.length - 1]._id;

    try {
      await this.esWriter.bulkSyncAuditlogs(upserts, deleteIds);
      this.consecutiveEventFailures = 0;
      this.lastFailingToken = null;
      this.consecutiveRestarts = 0;
    } catch (err) {
      // ResumeToken is `unknown`; JSON.stringify compares structurally without assertions.
      // A false mismatch only resets the counter and delays the poison-pill skip.
      if (
        JSON.stringify(firstToken) !== JSON.stringify(this.lastFailingToken)
      ) {
        this.consecutiveEventFailures = 0;
      }
      this.consecutiveEventFailures++;

      if (
        this.consecutiveEventFailures >=
        AuditlogChangeStreamService.MAX_CONSECUTIVE_EVENT_FAILURES
      ) {
        logger.error(
          { token: lastToken, batchSize: batch.length, err },
          'Skipping poison pill batch after consecutive failures.',
        );
        await AuditlogEsSyncStatus.setUnsynced(true);
        // Advance token past the poisoned batch; failure here means it is retried on restart.
        try {
          await ChangeStreamResumeToken.upsert(STREAM_KEY, lastToken);
        } catch (tokenErr) {
          logger.error(
            tokenErr,
            'Failed to advance token past poison pill batch; will retry on restart.',
          );
        }
        this.consecutiveEventFailures = 0;
        this.lastFailingToken = null;
        this.consecutiveRestarts = 0;
        return true;
      }

      this.lastFailingToken = firstToken;
      logger.error(
        { err },
        'AuditlogChangeStreamService batch handling failed.',
      );
      return false;
    }

    // Persist token at the batch boundary (not per event). Replay window: a crash before
    // this persists replays the batch on restart; ES index/delete are idempotent, so
    // reprocessing is safe (at-least-once).
    try {
      await ChangeStreamResumeToken.upsert(STREAM_KEY, lastToken);
    } catch (tokenErr) {
      logger.error(
        tokenErr,
        'Failed to persist resume token; batch will be reprocessed on restart.',
      );
    }
    return true;
  }

  private async restart(): Promise<void> {
    if (this.stopped || this.restarting) return;
    this.restarting = true;
    let startFailed = false;
    try {
      this.consecutiveRestarts++;
      const delay = Math.min(
        AuditlogChangeStreamService.RESTART_BASE_DELAY_MS *
          2 ** (this.consecutiveRestarts - 1),
        AuditlogChangeStreamService.RESTART_MAX_DELAY_MS,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, delay));

      if (this.stopped) return;
      await this.closeStream();
      await this.start();
    } catch (err) {
      logger.error(err, 'AuditlogChangeStreamService failed to restart.');
      startFailed = true;
    } finally {
      this.restarting = false;
    }
    // restarting is cleared in finally above; placing this inside catch would block on the guard
    if (!this.stopped && startFailed) {
      void this.restart();
    }
  }

  async close(): Promise<void> {
    this.stopped = true;
    await this.closeStream();
  }

  private async closeStream(): Promise<void> {
    if (this.changeStream != null) {
      await this.changeStream.close();
      this.changeStream = null;
    }
  }
}
