import loggerFactory from '~/utils/logger/index.js';

import { isAiEnabled } from '../is-ai-enabled.js';

const logger = loggerFactory('growi:openai:service:cron');

export const startCronIfEnabled = async (): Promise<void> => {
  if (isAiEnabled()) {
    logger.info('Starting cron service for thread deletion');
    const { ThreadDeletionCronService } = await import(
      './thread-deletion-cron.js'
    );
    const threadDeletionCronService = new ThreadDeletionCronService();
    threadDeletionCronService.startCron();

    logger.info('Starting cron service for vector store file deletion');
    const { VectorStoreFileDeletionCronService } = await import(
      './vector-store-file-deletion-cron.js'
    );
    const vectorStoreFileDeletionCronService =
      new VectorStoreFileDeletionCronService();
    vectorStoreFileDeletionCronService.startCron();
  }
};
