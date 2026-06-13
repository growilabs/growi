import { normalizeExpiredAtForThreadRelations } from '~/features/openai/server/services/normalize-data/index.js';
import loggerFactory from '~/utils/logger/index.js';

import { convertNullToEmptyGrantedArrays } from './convert-null-to-empty-granted-arrays.js';
import { convertRevisionPageIdToObjectId } from './convert-revision-page-id-to-objectid.js';
import { deleteVectorStoresOrphanedFromAiAssistant } from './delete-vector-stores-orphaned-from-ai-assistant.js';
import { renameDuplicateRootPages } from './rename-duplicate-root-pages.js';

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
