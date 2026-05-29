import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import CronService from './cron';
import type ElasticsearchDelegator from './search-delegator/elasticsearch';

const logger = loggerFactory('growi:service:auditlog-cleanup-cron');

// TODO: https://redmine.weseek.co.jp/issues/184206
export class AuditlogCleanupCronService extends CronService {
  private readonly delegator: ElasticsearchDelegator;

  constructor(delegator: ElasticsearchDelegator) {
    super();
    this.delegator = delegator;
  }

  getCronSchedule(): string {
    // Runs hourly; expired documents may remain in ES up to ~1 hour after MongoDB TTL deletion.
    return '0 * * * *';
  }

  async executeJob(): Promise<void> {
    const auditLogEnabled = configManager.getConfig('app:auditLogEnabled');
    if (!auditLogEnabled) {
      logger.debug(
        'Skipping expired auditlog deletion: auditLogEnabled is false.',
      );
      return;
    }
    const expirationSeconds = configManager.getConfig(
      'app:activityExpirationSeconds',
    );
    await this.delegator.deleteExpiredAuditlogs(expirationSeconds);
  }
}
