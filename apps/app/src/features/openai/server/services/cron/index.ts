import { isAiEnabled } from '~/features/openai/server/services/is-ai-enabled';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:openai:service:cron');

export const startCronIfEnabled = async (): Promise<void> => {
  if (isAiEnabled()) {
    logger.info('Starting cron service for thread deletion');
    const { ThreadDeletionCronService } = await import(
      '~/features/openai/server/services/cron/thread-deletion-cron'
    );
    const threadDeletionCronService = new ThreadDeletionCronService();
    threadDeletionCronService.startCron();

    logger.info('Starting cron service for vector store file deletion');
    const { VectorStoreFileDeletionCronService } = await import(
      '~/features/openai/server/services/cron/vector-store-file-deletion-cron'
    );
    const vectorStoreFileDeletionCronService =
      new VectorStoreFileDeletionCronService();
    vectorStoreFileDeletionCronService.startCron();
  }
};
