import type { ChangeStream, ChangeStreamOptions } from 'mongodb';
import mongoose from 'mongoose';

import loggerFactory from '~/utils/logger';

import type { ActivityDocument } from '../models/activity';
import { AuditlogEsSyncStatus } from '../models/auditlog-es-sync-status';
import { ChangeStreamResumeToken } from '../models/changestream-resume-token';
import { configManager } from './config-manager';
import type ElasticsearchDelegator from './search-delegator/elasticsearch';

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
  // Backoff: 1,2,4,8,16,30,30s. Skip a repeatedly failing event on its 8th failure (~91s total).
  private static readonly MAX_CONSECUTIVE_EVENT_FAILURES = 8;
  private static readonly RESTART_BASE_DELAY_MS = 1000;
  private static readonly RESTART_MAX_DELAY_MS = 30000;

  private readonly delegator: ElasticsearchDelegator;

  private changeStream: ChangeStream<ActivityDocument> | null = null;

  private stopped = false;

  private restarting = false;

  // Same-token failures, for poison pill detection. Not used for backoff.
  private consecutiveEventFailures = 0;

  // Restarts without forward progress, for backoff. Reset when the resume token advances.
  private consecutiveRestarts = 0;

  private lastFailingToken: unknown = null;

  constructor(delegator: ElasticsearchDelegator) {
    this.delegator = delegator;
  }

  async start(): Promise<void> {
    this.stopped = false;
    const auditLogEnabled = configManager.getConfig('app:auditLogEnabled');
    if (!auditLogEnabled) {
      logger.debug(
        'AuditlogChangeStreamService not started: auditLogEnabled is false.',
      );
      return;
    }

    const Activity = mongoose.model<ActivityDocument>('Activity');
    const token = await ChangeStreamResumeToken.load(STREAM_KEY);
    const options: ChangeStreamOptions =
      token != null ? { resumeAfter: token } : {};

    // Requires an open Mongo connection (Crowi awaits setupDatabase() before
    // SearchService.create()). A sync throw here means broken boot order, not a retryable error.
    this.changeStream = Activity.watch<ActivityDocument>([], options);

    void this.processChangeStream();

    logger.info('AuditlogChangeStreamService started.');
  }

  private async processChangeStream(): Promise<void> {
    if (this.changeStream == null) return;

    try {
      for await (const event of this.changeStream) {
        try {
          if (
            event.operationType === 'insert' &&
            'fullDocument' in event &&
            event.fullDocument != null
          ) {
            await this.delegator.updateOrInsertAuditlog(event.fullDocument);
          } else if (event.operationType === 'delete') {
            await this.delegator.deleteAuditlog(event.documentKey._id);
          }
          // Per-event upsert doubles MongoDB writes but keeps the replay window minimal on restart.
          // Throttle if write frequency becomes a concern.
          await ChangeStreamResumeToken.upsert(STREAM_KEY, event._id);
          this.consecutiveEventFailures = 0;
          this.lastFailingToken = null;
          this.consecutiveRestarts = 0;
        } catch (err) {
          // ResumeToken is typed as `unknown`; JSON.stringify compares structurally without type assertions.
          if (
            JSON.stringify(event._id) !== JSON.stringify(this.lastFailingToken)
          ) {
            this.consecutiveEventFailures = 0;
          }
          this.consecutiveEventFailures++;

          if (
            this.consecutiveEventFailures >=
            AuditlogChangeStreamService.MAX_CONSECUTIVE_EVENT_FAILURES
          ) {
            logger.error(
              { token: event._id, operationType: event.operationType, err },
              'Skipping poison pill event after consecutive failures.',
            );
            await AuditlogEsSyncStatus.setUnsynced(true);
            await ChangeStreamResumeToken.upsert(STREAM_KEY, event._id);
            this.consecutiveEventFailures = 0;
            this.lastFailingToken = null;
            this.consecutiveRestarts = 0;
            continue;
          }

          // Token not advanced on failure; event will be retried on restart.
          this.lastFailingToken = event._id;
          logger.error(
            { err },
            'AuditlogChangeStreamService change event handling failed.',
          );
          break;
        }
      }
    } catch (err) {
      if (isChangeStreamHistoryLost(err)) {
        logger.warn(
          'Change stream history lost (oplog truncated). Clearing resume token and restarting from current position.' +
            ' Documents written during the gap are not in Elasticsearch; run reindex to restore consistency.',
        );
        await ChangeStreamResumeToken.clear(STREAM_KEY);
        await AuditlogEsSyncStatus.setUnsynced(true);
      } else {
        logger.error(err, 'AuditlogChangeStreamService change stream error.');
      }
    }

    if (!this.stopped) {
      await this.restart();
    }
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
