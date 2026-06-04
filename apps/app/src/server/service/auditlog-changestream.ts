import type { ChangeStream, ChangeStreamOptions } from 'mongodb';
import mongoose from 'mongoose';

import loggerFactory from '~/utils/logger';

import type { ActivityDocument } from '../models/activity';
import { AuditlogDeadletterStore } from './auditlog-deadletter-store';
import { configManager } from './config-manager';
import { ResumeTokenStore } from './resume-token-store';
import type ElasticsearchDelegator from './search-delegator/elasticsearch';

const logger = loggerFactory('growi:service:auditlog-changestream');

const STREAM_KEY = 'auditlogs';

// MongoDB error code for ChangeStreamHistoryLost (oplog truncated)
const CHANGE_STREAM_HISTORY_LOST_CODE = 286;

const isChangeStreamHistoryLost = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false;
  if ('code' in err && err.code === CHANGE_STREAM_HISTORY_LOST_CODE)
    return true;
  if (err.message.includes('Resume of change stream was not possible'))
    return true;
  return false;
};

export class AuditlogChangeStreamService {
  // Backoff: 1,2,4,8,16,30,30s. Skip a repeatedly failing event after ~91s total (restart 8).
  private static readonly MAX_CONSECUTIVE_RESTARTS = 8;
  private static readonly RESTART_BASE_DELAY_MS = 1000;
  private static readonly RESTART_MAX_DELAY_MS = 30000;

  private readonly delegator: ElasticsearchDelegator;

  private changeStream: ChangeStream<ActivityDocument> | null = null;

  private restarting = false;

  private consecutiveRestarts = 0;

  private lastFailingToken: unknown = null;

  constructor(delegator: ElasticsearchDelegator) {
    this.delegator = delegator;
  }

  async start(): Promise<void> {
    const auditLogEnabled = configManager.getConfig('app:auditLogEnabled');
    if (!auditLogEnabled) {
      logger.debug(
        'AuditlogChangeStreamService not started: auditLogEnabled is false.',
      );
      return;
    }

    const Activity = mongoose.model<ActivityDocument>('Activity');
    const token = await ResumeTokenStore.load(STREAM_KEY);
    const options: ChangeStreamOptions =
      token != null ? { resumeAfter: token } : {};

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
          await ResumeTokenStore.save(STREAM_KEY, event._id);
          this.consecutiveRestarts = 0;
          this.lastFailingToken = null;
        } catch (err) {
          // Token not advanced on failure; event will be retried on restart.
          logger.error(
            { err },
            'AuditlogChangeStreamService change event handling failed.',
          );
          this.lastFailingToken = event._id;
          break;
        }
      }
    } catch (err) {
      if (isChangeStreamHistoryLost(err)) {
        logger.warn(
          'Change stream history lost (oplog truncated). Clearing resume token and restarting from current position.' +
            ' Documents written during the gap are not in Elasticsearch; run reindex to restore consistency.',
        );
        await ResumeTokenStore.clear(STREAM_KEY);
      } else {
        logger.error(err, 'AuditlogChangeStreamService change stream error.');
      }
    }

    await this.restart();
  }

  private async restart(): Promise<void> {
    if (this.restarting) return;
    this.restarting = true;
    try {
      this.consecutiveRestarts++;

      if (
        this.lastFailingToken != null &&
        this.consecutiveRestarts >=
          AuditlogChangeStreamService.MAX_CONSECUTIVE_RESTARTS
      ) {
        logger.error(
          { token: this.lastFailingToken },
          'Skipping poison pill event after consecutive failures.',
        );
        await AuditlogDeadletterStore.save(this.lastFailingToken);
        await ResumeTokenStore.save(STREAM_KEY, this.lastFailingToken);
        this.consecutiveRestarts = 0;
        this.lastFailingToken = null;
      } else {
        const delay = Math.min(
          AuditlogChangeStreamService.RESTART_BASE_DELAY_MS *
            2 ** (this.consecutiveRestarts - 1),
          AuditlogChangeStreamService.RESTART_MAX_DELAY_MS,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }

      await this.close();
      await this.start();
    } catch (err) {
      logger.error(err, 'AuditlogChangeStreamService failed to restart.');
    } finally {
      this.restarting = false;
    }
  }

  async close(): Promise<void> {
    if (this.changeStream != null) {
      await this.changeStream.close();
      this.changeStream = null;
    }
  }
}
