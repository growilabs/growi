import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import CronService from './cron';
import type ElasticsearchDelegator from './search-delegator/elasticsearch';

const logger = loggerFactory('growi:service:auditlog-cleanup-cron');

export class AuditlogCleanupCronService extends CronService {
  private readonly delegator: ElasticsearchDelegator;

  constructor(delegator: ElasticsearchDelegator) {
    super();
    this.delegator = delegator;
  }

  getCronSchedule(): string {
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
    const expirationSeconds =
      configManager.getConfig('app:activityExpirationSeconds') ?? 2592000;
    await this.delegator.deleteExpiredAuditlogs(expirationSeconds);
  }
}
