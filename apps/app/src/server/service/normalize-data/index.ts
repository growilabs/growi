import { normalizeExpiredAtForThreadRelations } from '~/features/openai/server/services/normalize-data';
import loggerFactory from '~/utils/logger';

import { convertNullToEmptyGrantedArrays } from './convert-null-to-empty-granted-arrays';
import { convertRevisionPageIdToObjectId } from './convert-revision-page-id-to-objectid';
import { deleteVectorStoresOrphanedFromAiAssistant } from './delete-vector-stores-orphaned-from-ai-assistant';
import { renameDuplicateRootPages } from './rename-duplicate-root-pages';

const logger = loggerFactory('growi:service:NormalizeData');

export const normalizeData = async (): Promise<void> => {
  await renameDuplicateRootPages();
  await convertRevisionPageIdToObjectId();
  await normalizeExpiredAtForThreadRelations();
  await convertNullToEmptyGrantedArrays();
  await deleteVectorStoresOrphanedFromAiAssistant();

  logger.info('normalizeData has been executed');
  return;
};
