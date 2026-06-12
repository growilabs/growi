import nodeCron from 'node-cron';

import { configManager } from '~/server/service/config-manager/index.js';
import loggerFactory from '~/utils/logger/index.js';
import { getRandomIntInRange } from '~/utils/rand.js';

import { isAiEnabled } from '~/features/openai/server/services/is-ai-enabled.js';
import { getOpenaiService, type IOpenaiService } from '~/features/openai/server/services/openai.js';

const logger = loggerFactory('growi:service:thread-deletion-cron');

export class ThreadDeletionCronService {
  cronJob: nodeCron.ScheduledTask;

  openaiService: IOpenaiService;

  threadDeletionCronExpression: string;

  threadDeletionCronMaxMinutesUntilRequest: number;

  threadDeletionBarchSize: number;

  threadDeletionApiCallInterval: number;

  sleep = (msec: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, msec));

  startCron(): void {
    if (!isAiEnabled()) {
      return;
    }

    const openaiService = getOpenaiService();
    if (openaiService == null) {
      throw new Error('OpenAI service is not initialized');
    }

    this.openaiService = openaiService;
    this.threadDeletionCronExpression = configManager.getConfig(
      'openai:threadDeletionCronExpression',
    );
    this.threadDeletionCronMaxMinutesUntilRequest = configManager.getConfig(
      'app:openaiThreadDeletionCronMaxMinutesUntilRequest',
    );
    this.threadDeletionBarchSize = configManager.getConfig(
      'openai:threadDeletionBarchSize',
    );
    this.threadDeletionApiCallInterval = configManager.getConfig(
      'openai:threadDeletionApiCallInterval',
    );

    this.cronJob?.stop();
    this.cronJob = this.generateCronJob();
    this.cronJob.start();
  }

  private async executeJob(): Promise<void> {
    // Must be careful of OpenAI's rate limit
    await this.openaiService.deleteExpiredThreads(
      this.threadDeletionBarchSize,
      this.threadDeletionApiCallInterval,
    );
  }

  private generateCronJob() {
    return nodeCron.schedule(this.threadDeletionCronExpression, async () => {
      try {
        // Random fractional sleep to distribute request timing among GROWI apps
        const randomMilliseconds =
          getRandomIntInRange(
            0,
            this.threadDeletionCronMaxMinutesUntilRequest,
          ) *
          60 *
          1000;
        await this.sleep(randomMilliseconds);

        await this.executeJob();
      } catch (e) {
        logger.error(e);
      }
    });
  }
}
