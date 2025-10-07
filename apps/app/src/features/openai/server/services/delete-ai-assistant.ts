import { getIdStringForRef, type IUserHasId } from '@growi/core';
import createError from 'http-errors';

import loggerFactory from '~/utils/logger';

import type { AiAssistantDocument } from '../models/ai-assistant';
import AiAssistantModel from '../models/ai-assistant';
import ThreadRelationModel from '../models/thread-relation';

import { isAiEnabled } from './is-ai-enabled';
import { getOpenaiService } from './openai';

const logger = loggerFactory('growi:service:openai:delete-ai-assistant');

export const deleteAiAssistant = async (
  ownerId: string,
  aiAssistantId: string,
): Promise<AiAssistantDocument> => {
  const openaiService = getOpenaiService();
  if (openaiService == null) {
    throw createError(500, 'openaiService is not initialized');
  }

  const aiAssistant = await AiAssistantModel.findOne({
    owner: ownerId,
    _id: aiAssistantId,
  });
  if (aiAssistant == null) {
    throw createError(404, 'AiAssistant document does not exist');
  }

  const vectorStoreRelationId = getIdStringForRef(aiAssistant.vectorStore);
  await openaiService.deleteVectorStore(vectorStoreRelationId);
  await ThreadRelationModel.deactivateByAiAssistantId(aiAssistant._id);

  const deletedAiAssistant = await aiAssistant.remove();
  return deletedAiAssistant;
};

export const deleteUserAiAssistant = async (
  user: IUserHasId,
): Promise<void> => {
  if (isAiEnabled()) {
    const aiAssistants = await AiAssistantModel.find({ owner: user });
    for await (const aiAssistant of aiAssistants) {
      try {
        await deleteAiAssistant(user._id, aiAssistant._id);
      } catch (err) {
        logger.error(`Failed to delete AiAssistant ${aiAssistant._id}`);
      }
    }
  }

  // Cannot delete OpenAI VectorStore entities without enabling openaiService.
  // Delete OpenAI VectorStore entities through "deleteVectorStoresOrphanedFromAiAssistant" when app starts with openaiService enabled
  await AiAssistantModel.deleteMany({ owner: user });
};
