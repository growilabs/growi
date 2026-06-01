import type {
  ChangeStream,
  ChangeStreamDocument,
  ChangeStreamOptions,
} from 'mongodb';
import mongoose from 'mongoose';

import loggerFactory from '~/utils/logger';

import type { ActivityDocument } from '../models/activity';
import { configManager } from './config-manager';
import { ResumeTokenStore } from './resume-token-store';
import type ElasticsearchDelegator from './search-delegator/elasticsearch';

const logger = loggerFactory('growi:service:auditlog-changestream');

const STREAM_KEY = 'auditlogs';

// MongoDB error code for ChangeStreamHistoryLost (oplog truncated)
const CHANGE_STREAM_HISTORY_LOST_CODE = 286;

const isChangeStreamHistoryLost = (err: Error): boolean => {
  const code = (err as Error & { code?: number }).code;
  if (code === CHANGE_STREAM_HISTORY_LOST_CODE) return true;
  if (err.message.includes('Resume of change stream was not possible')) {
    return true;
  }
  return false;
};

export class AuditlogChangeStreamService {
  private readonly delegator: ElasticsearchDelegator;

  private changeStream: ChangeStream<ActivityDocument> | null = null;

  private restarting = false;

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

    this.changeStream.on(
      'change',
      async (event: ChangeStreamDocument<ActivityDocument>) => {
        try {
          if (
            event.operationType === 'insert' &&
            'fullDocument' in event &&
            event.fullDocument != null
          ) {
            await this.delegator.updateOrInsertAuditlog(event.fullDocument);
          } else if (
            event.operationType === 'delete' &&
            'documentKey' in event
          ) {
            await this.delegator.deleteAuditlog(
              (event.documentKey as { _id: mongoose.Types.ObjectId })._id,
            );
          }
          await ResumeTokenStore.save(STREAM_KEY, event._id);
        } catch (err) {
          logger.error(
            { err },
            'AuditlogChangeStreamService change event handling failed.',
          );
        }
      },
    );

    this.changeStream.on('error', async (err: Error) => {
      if (isChangeStreamHistoryLost(err)) {
        logger.warn(
          'Change stream history lost. Clearing resume token and restarting from current position.',
        );
        await ResumeTokenStore.clear(STREAM_KEY);
      } else {
        logger.error(err, 'AuditlogChangeStreamService change stream error.');
      }
      await this.restart();
    });

    logger.info('AuditlogChangeStreamService started.');
  }

  private async restart(): Promise<void> {
    if (this.restarting) return;
    this.restarting = true;
    try {
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
