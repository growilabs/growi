import AiAssistantModel from '~/features/openai/server/models/ai-assistant';
import VectorStoreRelationModel from '~/features/openai/server/models/vector-store';
import { isAiEnabled } from '~/features/openai/server/services/is-ai-enabled';
import { getOpenaiService } from '~/features/openai/server/services/openai';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:service:normalize-data:delete-vector-stores-orphaned-from-ai-assistant',
);

export const deleteVectorStoresOrphanedFromAiAssistant =
  async (): Promise<void> => {
    if (!isAiEnabled()) {
      return;
    }

    // Identify VectorStoreRelation documents not related to existing aiAssistant documents as those used by old knowledge assistant
    // Retrieve these VectorStoreRelation documents used by old knowledge assistant
    // Only one active ({isDeleted: false}) VectorStoreRelation document should exist for old knowledge assistant, so only one should be returned
    const aiAssistantVectorStoreIds =
      await AiAssistantModel.distinct('vectorStore');
    const nonDeletedLegacyKnowledgeAssistantVectorStoreRelations =
      await VectorStoreRelationModel.find({
        _id: { $nin: aiAssistantVectorStoreIds },
        isDeleted: false,
      });

    // Logically delete only the VectorStore entities, leaving related documents to be automatically deleted by cron job
    const openaiService = getOpenaiService();
    for await (const vectorStoreRelation of nonDeletedLegacyKnowledgeAssistantVectorStoreRelations) {
      try {
        const vectorStoreFileRelationId = vectorStoreRelation._id;
        await openaiService?.deleteVectorStore(vectorStoreFileRelationId);
      } catch (err) {
        logger.error(err);
      }
    }
  };
