import nodeCron from 'node-cron';

import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';
import { getRandomIntInRange } from '~/utils/rand';

import { isAiEnabled } from '../is-ai-enabled';
import { getOpenaiService, type IOpenaiService } from '../openai';

const logger = loggerFactory('growi:service:vector-store-file-deletion-cron');

export class VectorStoreFileDeletionCronService {
  cronJob: nodeCron.ScheduledTask;

  openaiService: IOpenaiService;

  vectorStoreFileDeletionCronExpression: string;

  vectorStoreFileDeletionCronMaxMinutesUntilRequest: number;

  vectorStoreFileDeletionBarchSize: number;

  vectorStoreFileDeletionApiCallInterval: number;

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
    this.vectorStoreFileDeletionCronExpression = configManager.getConfig(
      'openai:vectorStoreFileDeletionCronExpression',
    );
    this.vectorStoreFileDeletionCronMaxMinutesUntilRequest =
      configManager.getConfig(
        'app:openaiVectorStoreFileDeletionCronMaxMinutesUntilRequest',
      );
    this.vectorStoreFileDeletionBarchSize = configManager.getConfig(
      'openai:vectorStoreFileDeletionBarchSize',
    );
    this.vectorStoreFileDeletionApiCallInterval = configManager.getConfig(
      'openai:vectorStoreFileDeletionApiCallInterval',
    );

    this.cronJob?.stop();
    this.cronJob = this.generateCronJob();
    this.cronJob.start();
  }

  private async executeJob(): Promise<void> {
    await this.openaiService.deleteObsoletedVectorStoreRelations();
    await this.openaiService.deleteObsoleteVectorStoreFile(
      this.vectorStoreFileDeletionBarchSize,
      this.vectorStoreFileDeletionApiCallInterval,
    );
  }

  private generateCronJob() {
    return nodeCron.schedule(
      this.vectorStoreFileDeletionCronExpression,
      async () => {
        try {
          // Random fractional sleep to distribute request timing among GROWI apps
          const randomMilliseconds =
            getRandomIntInRange(
              0,
              this.vectorStoreFileDeletionCronMaxMinutesUntilRequest,
            ) *
            60 *
            1000;
          await this.sleep(randomMilliseconds);

          await this.executeJob();
        } catch (e) {
          logger.error(e);
        }
      },
    );
  }
}
