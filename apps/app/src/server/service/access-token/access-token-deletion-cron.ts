import nodeCron from 'node-cron';

import { AccessToken } from '~/server/models/access-token';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:service:access-token-deletion-cron');

export class AccessTokenDeletionCronService {

  cronJob: nodeCron.ScheduledTask;

  // Default execution at midnight
  accessTokenDeletionCronExpression = '0 15 * * *';

  startCron(): void {
    const cronExp = configManager.getConfig('accessToken:deletionCronExpression');
    if (cronExp != null) {
      this.accessTokenDeletionCronExpression = cronExp;
    }

    this.cronJob?.stop();
    this.cronJob = this.generateCronJob();
    this.cronJob.start();

    logger.info('Access token deletion cron started');
  }

  private async executeJob(): Promise<void> {
    try {
      await AccessToken.deleteExpiredToken();
      logger.info('Expired access tokens have been deleted');
    }
    catch (e) {
      logger.error('Failed to delete expired access tokens:', e);
    }
  }

  private generateCronJob() {
    return nodeCron.schedule(this.accessTokenDeletionCronExpression, async() => {
      try {
        await this.executeJob();
      }
      catch (e) {
        logger.error('Error occurred during access token deletion cron job:', e);
      }
    });
  }

}

export const startCron = (): void => {
  logger.info('Starting cron service for access token deletion');
  const accessTokenDeletionCronService = new AccessTokenDeletionCronService();
  accessTokenDeletionCronService.startCron();
};
