import assert from 'node:assert';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';

import type {
  IUser, Ref, Lang, IPage,
} from '@growi/core';
import {
  PageGrant, getIdForRef, getIdStringForRef, isPopulated, type IUserHasId,
} from '@growi/core';
import { deepEquals } from '@growi/core/dist/utils';
import { isGlobPatternPath } from '@growi/core/dist/utils/page-path-utils';
import escapeStringRegexp from 'escape-string-regexp';
import createError from 'http-errors';
import mongoose, { type HydratedDocument, type Types } from 'mongoose';
import { type OpenAI, toFile } from 'openai';

import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import ThreadRelationModel, { type ThreadRelationDocument } from '~/features/openai/server/models/thread-relation';
import VectorStoreModel, { type VectorStoreDocument } from '~/features/openai/server/models/vector-store';
import VectorStoreFileRelationModel, {
  type VectorStoreFileRelation,
  prepareVectorStoreFileRelations,
} from '~/features/openai/server/models/vector-store-file-relation';
import type { PageDocument, PageModel } from '~/server/models/page';
import UserGroupRelation from '~/server/models/user-group-relation';
import { configManager } from '~/server/service/config-manager';
import { createBatchStream } from '~/server/util/batch-stream';
import loggerFactory from '~/utils/logger';

import { OpenaiServiceTypes } from '../../interfaces/ai';
import type { UpsertAiAssistantData } from '../../interfaces/ai-assistant';
import {
  type AccessibleAiAssistants, type AiAssistant, AiAssistantAccessScope, AiAssistantShareScope,
} from '../../interfaces/ai-assistant';
import type { MessageListParams } from '../../interfaces/message';
import { removeGlobPath } from '../../utils/remove-glob-path';
import AiAssistantModel, { type AiAssistantDocument } from '../models/ai-assistant';
import { convertMarkdownToHtml } from '../utils/convert-markdown-to-html';
import { generateGlobPatterns } from '../utils/generate-glob-patterns';

import { getClient } from './client-delegator';
import { openaiApiErrorHandler } from './openai-api-error-handler';
import { replaceAnnotationWithPageLink } from './replace-annotation-with-page-link';

const { isDeepEquals } = deepEquals;

const BATCH_SIZE = 100;

const logger = loggerFactory('growi:service:openai');


type VectorStoreFileRelationsMap = Map<string, VectorStoreFileRelation>


const convertPathPatternsToRegExp = (pagePathPatterns: string[]): Array<string | RegExp> => {
  return pagePathPatterns.map((pagePathPattern) => {
    if (isGlobPatternPath(pagePathPattern)) {
      const trimedPagePathPattern = pagePathPattern.replace('/*', '');
      const escapedPagePathPattern = escapeStringRegexp(trimedPagePathPattern);
      // https://regex101.com/r/x5KIZL/1
      return new RegExp(`^${escapedPagePathPattern}($|/)`);
    }
    return pagePathPattern;
  });
};

export interface IOpenaiService {
  createThread(userId: string, aiAssistantId: string, initialUserMessage: string): Promise<ThreadRelationDocument>;
  getThreadsByAiAssistantId(aiAssistantId: string): Promise<ThreadRelationDocument[]>
  deleteThread(threadRelationId: string): Promise<ThreadRelationDocument>;
  deleteExpiredThreads(limit: number, apiCallInterval: number): Promise<void>; // for CronJob
  deleteObsoletedVectorStoreRelations(): Promise<void> // for CronJob
  deleteVectorStore(vectorStoreRelationId: string): Promise<void>;
  getMessageData(threadId: string, lang?: Lang, options?: MessageListParams): Promise<OpenAI.Beta.Threads.Messages.MessagesPage>;
  createVectorStoreFile(vectorStoreRelation: VectorStoreDocument, pages: PageDocument[]): Promise<void>;
  createVectorStoreFileOnPageCreate(pages: PageDocument[]): Promise<void>;
  updateVectorStoreFileOnPageUpdate(page: HydratedDocument<PageDocument>): Promise<void>;
  deleteVectorStoreFile(vectorStoreRelationId: Types.ObjectId, pageId: Types.ObjectId): Promise<void>;
  deleteVectorStoreFilesByPageIds(pageIds: Types.ObjectId[]): Promise<void>;
  deleteObsoleteVectorStoreFile(limit: number, apiCallInterval: number): Promise<void>; // for CronJob
  isAiAssistantUsable(aiAssistantId: string, user: IUserHasId): Promise<boolean>;
  createAiAssistant(data: UpsertAiAssistantData, user: IUserHasId): Promise<AiAssistantDocument>;
  updateAiAssistant(aiAssistantId: string, data: UpsertAiAssistantData, user: IUserHasId): Promise<AiAssistantDocument>;
  getAccessibleAiAssistants(user: IUserHasId): Promise<AccessibleAiAssistants>
  isLearnablePageLimitExceeded(user: IUserHasId, pagePathPatterns: string[]): Promise<boolean>;
}
class OpenaiService implements IOpenaiService {

  private get client() {
    const openaiServiceType = configManager.getConfig('openai:serviceType');
    return getClient({ openaiServiceType });
  }

  async generateThreadTitle(message: string): Promise<string | null> {
    const model = configManager.getConfig('openai:assistantModel:chat');
    const systemMessage = [
      'Create a brief title (max 5 words) from your message.',
      'Respond in the same language the user uses in their input.',
      'Response should only contain the title.',
    ].join('');

    const threadTitleCompletion = await this.client.chatCompletion({
      model,
      messages: [
        {
          role: 'system',
          content: systemMessage,
        },
        {
          role: 'user',
          content: message,
        },
      ],
    });

    const threadTitle = threadTitleCompletion.choices[0].message.content;
    return threadTitle;
  }

  async createThread(userId: string, aiAssistantId: string, initialUserMessage: string): Promise<ThreadRelationDocument> {
    const vectorStoreRelation = await this.getVectorStoreRelationByAiAssistantId(aiAssistantId);

    let threadTitle: string | null = null;
    if (initialUserMessage != null) {
      try {
        threadTitle = await this.generateThreadTitle(initialUserMessage);
      }
      catch (err) {
        logger.error(err);
      }
    }

    try {
      const thread = await this.client.createThread(vectorStoreRelation.vectorStoreId);
      const threadRelation = await ThreadRelationModel.create({
        userId,
        aiAssistant: aiAssistantId,
        threadId: thread.id,
        title: threadTitle,
      });
      return threadRelation;
    }
    catch (err) {
      throw err;
    }
  }

  async updateThreads(aiAssistantId: string, vectorStoreId: string): Promise<void> {
    const threadRelations = await this.getThreadsByAiAssistantId(aiAssistantId);
    for await (const threadRelation of threadRelations) {
      try {
        const updatedThreadResponse = await this.client.updateThread(threadRelation.threadId, vectorStoreId);
        logger.debug('Update thread', updatedThreadResponse);
      }
      catch (err) {
        logger.error(err);
      }
    }
  }

  async getThreadsByAiAssistantId(aiAssistantId: string): Promise<ThreadRelationDocument[]> {
    const threadRelations = await ThreadRelationModel.find({ aiAssistant: aiAssistantId });
    return threadRelations;
  }

  async deleteThread(threadRelationId: string): Promise<ThreadRelationDocument> {
    const threadRelation = await ThreadRelationModel.findById(threadRelationId);
    if (threadRelation == null) {
      throw createError(404, 'ThreadRelation document does not exist');
    }

    try {
      const deletedThreadResponse = await this.client.deleteThread(threadRelation.threadId);
      logger.debug('Delete thread', deletedThreadResponse);
      await threadRelation.remove();
    }
    catch (err) {
      await openaiApiErrorHandler(err, { notFoundError: async() => { await threadRelation.remove() } });
      throw err;
    }

    return threadRelation;
  }

  public async deleteExpiredThreads(limit: number, apiCallInterval: number): Promise<void> {
    const expiredThreadRelations = await ThreadRelationModel.getExpiredThreadRelations(limit);
    if (expiredThreadRelations == null) {
      return;
    }

    const deletedThreadIds: string[] = [];
    for await (const expiredThreadRelation of expiredThreadRelations) {
      try {
        const deleteThreadResponse = await this.client.deleteThread(expiredThreadRelation.threadId);
        logger.debug('Delete thread', deleteThreadResponse);
        deletedThreadIds.push(expiredThreadRelation.threadId);

        // sleep
        await new Promise(resolve => setTimeout(resolve, apiCallInterval));
      }
      catch (err) {
        logger.error(err);
      }
    }

    await ThreadRelationModel.deleteMany({ threadId: { $in: deletedThreadIds } });
  }

  async getMessageData(threadId: string, lang?: Lang, options?: MessageListParams): Promise<OpenAI.Beta.Threads.Messages.MessagesPage> {
    const messages = await this.client.getMessages(threadId, options);

    for await (const message of messages.data) {
      for await (const content of message.content) {
        if (content.type === 'text') {
          await replaceAnnotationWithPageLink(content, lang);
        }
      }
    }

    return messages;
  }


  async getVectorStoreRelationByAiAssistantId(aiAssistantId: string): Promise<VectorStoreDocument> {
    const aiAssistant = await AiAssistantModel.findOne({ _id: { $eq: aiAssistantId } }).populate('vectorStore');
    if (aiAssistant == null) {
      throw createError(404, 'AiAssistant document does not exist');
    }

    return aiAssistant.vectorStore as VectorStoreDocument;
  }

  async getVectorStoreRelationsByPageIds(pageIds: Types.ObjectId[]): Promise<VectorStoreDocument[]> {
    const pipeline = [
      // Stage 1: Match documents with the given pageId
      {
        $match: {
          page: {
            $in: pageIds,
          },
        },
      },
      // Stage 2: Lookup VectorStore documents
      {
        $lookup: {
          from: 'vectorstores',
          localField: 'vectorStoreRelationId',
          foreignField: '_id',
          as: 'vectorStore',
        },
      },
      // Stage 3: Unwind the vectorStore array
      {
        $unwind: '$vectorStore',
      },
      // Stage 4: Match non-deleted vector stores
      {
        $match: {
          'vectorStore.isDeleted': false,
        },
      },
      // Stage 5: Replace the root with vectorStore document
      {
        $replaceRoot: {
          newRoot: '$vectorStore',
        },
      },
      // Stage 6: Group by _id to remove duplicates
      {
        $group: {
          _id: '$_id',
          doc: { $first: '$$ROOT' },
        },
      },
      // Stage 7: Restore the document structure
      {
        $replaceRoot: {
          newRoot: '$doc',
        },
      },
    ];

    const vectorStoreRelations = await VectorStoreFileRelationModel.aggregate<VectorStoreDocument>(pipeline);
    return vectorStoreRelations;
  }

  private async createVectorStore(name: string): Promise<VectorStoreDocument> {
    try {
      const newVectorStore = await this.client.createVectorStore(name);

      const newVectorStoreDocument = await VectorStoreModel.create({
        vectorStoreId: newVectorStore.id,
      }) as VectorStoreDocument;

      return newVectorStoreDocument;
    }
    catch (err) {
      throw new Error(err);
    }
  }

  private async uploadFile(pageId: Types.ObjectId, pagePath: string, revisionBody: string): Promise<OpenAI.Files.FileObject> {
    const convertedHtml = await convertMarkdownToHtml({ pagePath, revisionBody });
    const file = await toFile(Readable.from(convertedHtml), `${pageId}.html`);
    const uploadedFile = await this.client.uploadFile(file);
    return uploadedFile;
  }

  async deleteVectorStore(vectorStoreRelationId: string): Promise<void> {
    const vectorStoreDocument: VectorStoreDocument | null = await VectorStoreModel.findOne({ _id: vectorStoreRelationId, isDeleted: false });
    if (vectorStoreDocument == null) {
      return;
    }

    try {
      const deleteVectorStoreResponse = await this.client.deleteVectorStore(vectorStoreDocument.vectorStoreId);
      logger.debug('Delete vector store', deleteVectorStoreResponse);
      await vectorStoreDocument.markAsDeleted();
    }
    catch (err) {
      await openaiApiErrorHandler(err, { notFoundError: vectorStoreDocument.markAsDeleted });
      throw new Error(err);
    }
  }

  async createVectorStoreFile(vectorStoreRelation: VectorStoreDocument, pages: Array<HydratedDocument<PageDocument>>): Promise<void> {
    // const vectorStore = await this.getOrCreateVectorStoreForPublicScope();
    const vectorStoreFileRelationsMap: VectorStoreFileRelationsMap = new Map();
    const processUploadFile = async(page: HydratedDocument<PageDocument>) => {
      if (page._id != null && page.revision != null) {
        if (isPopulated(page.revision) && page.revision.body.length > 0) {
          const uploadedFile = await this.uploadFile(page._id, page.path, page.revision.body);
          prepareVectorStoreFileRelations(vectorStoreRelation._id, page._id, uploadedFile.id, vectorStoreFileRelationsMap);
          return;
        }

        const pagePopulatedToShowRevision = await page.populateDataToShowRevision();
        if (pagePopulatedToShowRevision.revision != null && pagePopulatedToShowRevision.revision.body.length > 0) {
          const uploadedFile = await this.uploadFile(page._id, page.path, pagePopulatedToShowRevision.revision.body);
          prepareVectorStoreFileRelations(vectorStoreRelation._id, page._id, uploadedFile.id, vectorStoreFileRelationsMap);
        }
      }
    };

    // Start workers to process results
    const workers = pages.map(processUploadFile);

    // Wait for all processing to complete.
    assert(workers.length <= BATCH_SIZE, 'workers.length must be less than or equal to BATCH_SIZE');
    const fileUploadResult = await Promise.allSettled(workers);
    fileUploadResult.forEach((result) => {
      if (result.status === 'rejected') {
        logger.error(result.reason);
      }
    });

    const vectorStoreFileRelations = Array.from(vectorStoreFileRelationsMap.values());
    const uploadedFileIds = vectorStoreFileRelations.map(data => data.fileIds).flat();

    if (uploadedFileIds.length === 0) {
      return;
    }

    const pageIds = pages.map(page => page._id);

    try {
      // Save vector store file relation
      await VectorStoreFileRelationModel.upsertVectorStoreFileRelations(vectorStoreFileRelations);

      // Create vector store file
      const createVectorStoreFileBatchResponse = await this.client.createVectorStoreFileBatch(vectorStoreRelation.vectorStoreId, uploadedFileIds);
      logger.debug('Create vector store file', createVectorStoreFileBatchResponse);

      // Set isAttachedToVectorStore: true when the uploaded file is attached to VectorStore
      await VectorStoreFileRelationModel.markAsAttachedToVectorStore(pageIds);
    }
    catch (err) {
      logger.error(err);

      // Delete all uploaded files if createVectorStoreFileBatch fails
      for await (const pageId of pageIds) {
        await this.deleteVectorStoreFile(vectorStoreRelation._id, pageId);
      }
    }

  }

  // Deletes all VectorStore documents that are marked as deleted (isDeleted: true) and have no associated VectorStoreFileRelation documents
  async deleteObsoletedVectorStoreRelations(): Promise<void> {
    const deletedVectorStoreRelations = await VectorStoreModel.find({ isDeleted: true });
    if (deletedVectorStoreRelations.length === 0) {
      return;
    }

    const currentVectorStoreRelationIds: Types.ObjectId[] = await VectorStoreFileRelationModel.aggregate([
      {
        $group: {
          _id: '$vectorStoreRelationId',
          relationCount: { $sum: 1 },
        },
      },
      { $match: { relationCount: { $gt: 0 } } },
      { $project: { _id: 1 } },
    ]);

    if (currentVectorStoreRelationIds.length === 0) {
      return;
    }

    await VectorStoreModel.deleteMany({ _id: { $nin: currentVectorStoreRelationIds }, isDeleted: true });
  }

  async deleteVectorStoreFile(vectorStoreRelationId: Types.ObjectId, pageId: Types.ObjectId, apiCallInterval?: number): Promise<void> {
    // Delete vector store file and delete vector store file relation
    const vectorStoreFileRelation = await VectorStoreFileRelationModel.findOne({ vectorStoreRelationId, page: pageId });
    if (vectorStoreFileRelation == null) {
      return;
    }

    const deletedFileIds: string[] = [];
    for await (const fileId of vectorStoreFileRelation.fileIds) {
      try {
        const deleteFileResponse = await this.client.deleteFile(fileId);
        logger.debug('Delete vector store file', deleteFileResponse);
        deletedFileIds.push(fileId);
        if (apiCallInterval != null) {
          // sleep
          await new Promise(resolve => setTimeout(resolve, apiCallInterval));
        }
      }
      catch (err) {
        await openaiApiErrorHandler(err, { notFoundError: async() => { deletedFileIds.push(fileId) } });
        logger.error(err);
      }
    }

    const undeletedFileIds = vectorStoreFileRelation.fileIds.filter(fileId => !deletedFileIds.includes(fileId));

    if (undeletedFileIds.length === 0) {
      await vectorStoreFileRelation.remove();
      return;
    }

    vectorStoreFileRelation.fileIds = undeletedFileIds;
    await vectorStoreFileRelation.save();
  }

  async deleteVectorStoreFilesByPageIds(pageIds: Types.ObjectId[]): Promise<void> {
    const vectorStoreRelations = await this.getVectorStoreRelationsByPageIds(pageIds);
    if (vectorStoreRelations != null && vectorStoreRelations.length !== 0) {
      for await (const pageId of pageIds) {
        const deleteVectorStoreFilePromises = vectorStoreRelations.map(vectorStoreRelation => this.deleteVectorStoreFile(vectorStoreRelation._id, pageId));
        await Promise.allSettled(deleteVectorStoreFilePromises);
      }
    }
  }

  async deleteObsoleteVectorStoreFile(limit: number, apiCallInterval: number): Promise<void> {
    // Retrieves all VectorStore documents that are marked as deleted
    const deletedVectorStoreRelations = await VectorStoreModel.find({ isDeleted: true });
    if (deletedVectorStoreRelations.length === 0) {
      return;
    }

    // Retrieves VectorStoreFileRelation documents associated with deleted VectorStore documents
    const obsoleteVectorStoreFileRelations = await VectorStoreFileRelationModel.find(
      { vectorStoreRelationId: { $in: deletedVectorStoreRelations.map(deletedVectorStoreRelation => deletedVectorStoreRelation._id) } },
    ).limit(limit);
    if (obsoleteVectorStoreFileRelations.length === 0) {
      return;
    }

    // Delete obsolete VectorStoreFile
    for await (const vectorStoreFileRelation of obsoleteVectorStoreFileRelations) {
      try {
        await this.deleteVectorStoreFile(vectorStoreFileRelation.vectorStoreRelationId, vectorStoreFileRelation.page, apiCallInterval);
      }
      catch (err) {
        logger.error(err);
      }
    }
  }

  async filterPagesByAccessScope(aiAssistant: AiAssistantDocument, pages: HydratedDocument<PageDocument>[]) {
    const isPublicPage = (page :HydratedDocument<PageDocument>) => page.grant === PageGrant.GRANT_PUBLIC;

    const isUserGroupAccessible = (page :HydratedDocument<PageDocument>, ownerUserGroupIds: string[]) => {
      if (page.grant !== PageGrant.GRANT_USER_GROUP) return false;
      return page.grantedGroups.some(group => ownerUserGroupIds.includes(getIdStringForRef(group.item)));
    };

    const isOwnerAccessible = (page: HydratedDocument<PageDocument>, ownerId: Ref<IUser>) => {
      if (page.grant !== PageGrant.GRANT_OWNER) return false;
      return page.grantedUsers.some(user => getIdStringForRef(user) === getIdStringForRef(ownerId));
    };

    const getOwnerUserGroupIds = async(owner: Ref<IUser>) => {
      const userGroups = await UserGroupRelation.findAllUserGroupIdsRelatedToUser(owner);
      const externalGroups = await ExternalUserGroupRelation.findAllUserGroupIdsRelatedToUser(owner);
      return [...userGroups, ...externalGroups].map(group => getIdStringForRef(group));
    };

    switch (aiAssistant.accessScope) {
      case AiAssistantAccessScope.PUBLIC_ONLY:
        return pages.filter(isPublicPage);

      case AiAssistantAccessScope.GROUPS: {
        const ownerUserGroupIds = await getOwnerUserGroupIds(aiAssistant.owner);
        return pages.filter(page => isPublicPage(page) || isUserGroupAccessible(page, ownerUserGroupIds));
      }

      case AiAssistantAccessScope.OWNER: {
        const ownerUserGroupIds = await getOwnerUserGroupIds(aiAssistant.owner);
        return pages.filter(page => isPublicPage(page) || isOwnerAccessible(page, aiAssistant.owner) || isUserGroupAccessible(page, ownerUserGroupIds));
      }

      default:
        return [];
    }
  }

  async createVectorStoreFileOnPageCreate(pages: HydratedDocument<PageDocument>[]): Promise<void> {
    const pagePaths = pages.map(page => page.path);
    const aiAssistants = await this.findAiAssistantByPagePath(pagePaths, { shouldPopulateOwner: true, shouldPopulateVectorStore: true });

    if (aiAssistants.length === 0) {
      return;
    }

    for await (const aiAssistant of aiAssistants) {
      if (!isPopulated(aiAssistant.owner)) {
        continue;
      }

      const isLearnablePageLimitExceeded = await this.isLearnablePageLimitExceeded(aiAssistant.owner, aiAssistant.pagePathPatterns);
      if (isLearnablePageLimitExceeded) {
        continue;
      }

      const pagesToVectorize = await this.filterPagesByAccessScope(aiAssistant, pages);
      const vectorStoreRelation = aiAssistant.vectorStore;
      if (vectorStoreRelation == null || !isPopulated(vectorStoreRelation)) {
        continue;
      }

      logger.debug('--------- createVectorStoreFileOnPageCreate ---------');
      logger.debug('AccessScopeType of aiAssistant: ', aiAssistant.accessScope);
      logger.debug('VectorStoreFile pagePath to be created: ', pagesToVectorize.map(page => page.path));
      logger.debug('-----------------------------------------------------');

      await this.createVectorStoreFile(vectorStoreRelation as VectorStoreDocument, pagesToVectorize);
    }
  }

  async updateVectorStoreFileOnPageUpdate(page: HydratedDocument<PageDocument>) {
    const aiAssistants = await this.findAiAssistantByPagePath([page.path], { shouldPopulateVectorStore: true });

    if (aiAssistants.length === 0) {
      return;
    }

    for await (const aiAssistant of aiAssistants) {
      const pagesToVectorize = await this.filterPagesByAccessScope(aiAssistant, [page]);
      const vectorStoreRelation = aiAssistant.vectorStore;
      if (vectorStoreRelation == null || !isPopulated(vectorStoreRelation)) {
        continue;
      }

      logger.debug('---------- updateVectorStoreOnPageUpdate ------------');
      logger.debug('AccessScopeType of aiAssistant: ', aiAssistant.accessScope);
      logger.debug('PagePath of VectorStoreFile to be deleted: ', page.path);
      logger.debug('pagePath of VectorStoreFile to be created: ', pagesToVectorize.map(page => page.path));
      logger.debug('-----------------------------------------------------');

      // Do not create a new VectorStoreFile if page is changed to a permission that AiAssistant does not have access to
      await this.createVectorStoreFile(vectorStoreRelation as VectorStoreDocument, pagesToVectorize);
      await this.deleteVectorStoreFile((vectorStoreRelation as VectorStoreDocument)._id, page._id);
    }
  }

  private async createVectorStoreFileWithStream(vectorStoreRelation: VectorStoreDocument, conditions: mongoose.FilterQuery<PageDocument>): Promise<void> {
    const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>('Page');

    const pagesStream = Page.find({ ...conditions })
      .populate('revision')
      .cursor({ batchSize: BATCH_SIZE });
    const batchStream = createBatchStream(BATCH_SIZE);

    const createVectorStoreFile = this.createVectorStoreFile.bind(this);
    const createVectorStoreFileStream = new Transform({
      objectMode: true,
      async transform(chunk: HydratedDocument<PageDocument>[], encoding, callback) {
        try {
          logger.debug('Search results of page paths', chunk.map(page => page.path));
          await createVectorStoreFile(vectorStoreRelation, chunk);
          this.push(chunk);
          callback();
        }
        catch (error) {
          callback(error);
        }
      },
    });

    await pipeline(pagesStream, batchStream, createVectorStoreFileStream);
  }

  private async createConditionForCreateVectorStoreFile(
      owner: AiAssistant['owner'],
      accessScope: AiAssistant['accessScope'],
      grantedGroupsForAccessScope: AiAssistant['grantedGroupsForAccessScope'],
      pagePathPatterns: AiAssistant['pagePathPatterns'],
  ): Promise<mongoose.FilterQuery<PageDocument>> {

    const convertedPagePathPatterns = convertPathPatternsToRegExp(pagePathPatterns);

    // Include pages in search targets when their paths with 'Anyone with the link' permission are directly specified instead of using glob pattern
    const nonGrabPagePathPatterns = pagePathPatterns.filter(pagePathPattern => !isGlobPatternPath(pagePathPattern));
    const baseCondition: mongoose.FilterQuery<PageDocument> = {
      grant: PageGrant.GRANT_RESTRICTED,
      path: { $in: nonGrabPagePathPatterns },
    };

    if (accessScope === AiAssistantAccessScope.PUBLIC_ONLY) {
      return {
        $or: [
          baseCondition,
          {
            grant: PageGrant.GRANT_PUBLIC,
            path: { $in: convertedPagePathPatterns },
          },
        ],
      };
    }

    if (accessScope === AiAssistantAccessScope.GROUPS) {
      if (grantedGroupsForAccessScope == null || grantedGroupsForAccessScope.length === 0) {
        throw new Error('grantedGroups is required when accessScope is GROUPS');
      }

      const extractedGrantedGroupIdsForAccessScope = grantedGroupsForAccessScope.map(group => getIdForRef(group.item).toString());

      return {
        $or: [
          baseCondition,
          {
            grant: { $in: [PageGrant.GRANT_PUBLIC, PageGrant.GRANT_USER_GROUP] },
            path: { $in: convertedPagePathPatterns },
            $or: [
              { 'grantedGroups.item': { $in: extractedGrantedGroupIdsForAccessScope } },
              { grant: PageGrant.GRANT_PUBLIC },
            ],
          },
        ],
      };
    }

    if (accessScope === AiAssistantAccessScope.OWNER) {
      const ownerUserGroups = [
        ...(await UserGroupRelation.findAllUserGroupIdsRelatedToUser(owner)),
        ...(await ExternalUserGroupRelation.findAllUserGroupIdsRelatedToUser(owner)),
      ].map(group => group.toString());

      return {
        $or: [
          baseCondition,
          {
            grant: { $in: [PageGrant.GRANT_PUBLIC, PageGrant.GRANT_USER_GROUP, PageGrant.GRANT_OWNER] },
            path: { $in: convertedPagePathPatterns },
            $or: [
              { 'grantedGroups.item': { $in: ownerUserGroups } },
              { grantedUsers: { $in: [getIdForRef(owner)] } },
              { grant: PageGrant.GRANT_PUBLIC },
            ],
          },
        ],
      };
    }

    throw new Error('Invalid accessScope value');
  }

  private async validateGrantedUserGroupsForAiAssistant(
      owner: AiAssistant['owner'],
      shareScope: AiAssistant['shareScope'],
      accessScope: AiAssistant['accessScope'],
      grantedGroupsForShareScope: AiAssistant['grantedGroupsForShareScope'],
      grantedGroupsForAccessScope: AiAssistant['grantedGroupsForAccessScope'],
  ) {

    // Check if grantedGroupsForShareScope is not specified when shareScope is not a “group”
    if (shareScope !== AiAssistantShareScope.GROUPS && grantedGroupsForShareScope != null) {
      throw new Error('grantedGroupsForShareScope is specified when shareScope is not “groups”.');
    }

    // Check if grantedGroupsForAccessScope is not specified when accessScope is not a “group”
    if (accessScope !== AiAssistantAccessScope.GROUPS && grantedGroupsForAccessScope != null) {
      throw new Error('grantedGroupsForAccessScope is specified when accsessScope is not “groups”.');
    }

    const ownerUserGroupIds = [
      ...(await UserGroupRelation.findAllUserGroupIdsRelatedToUser(owner)),
      ...(await ExternalUserGroupRelation.findAllUserGroupIdsRelatedToUser(owner)),
    ].map(group => group.toString());

    // Check if the owner belongs to the group specified in grantedGroupsForShareScope
    if (grantedGroupsForShareScope != null && grantedGroupsForShareScope.length > 0) {
      const extractedGrantedGroupIdsForShareScope = grantedGroupsForShareScope.map(group => getIdForRef(group.item).toString());
      const isValid = extractedGrantedGroupIdsForShareScope.every(groupId => ownerUserGroupIds.includes(groupId));
      if (!isValid) {
        throw new Error('A userGroup to which the owner does not belong is specified in grantedGroupsForShareScope');
      }
    }

    // Check if the owner belongs to the group specified in grantedGroupsForAccessScope
    if (grantedGroupsForAccessScope != null && grantedGroupsForAccessScope.length > 0) {
      const extractedGrantedGroupIdsForAccessScope = grantedGroupsForAccessScope.map(group => getIdForRef(group.item).toString());
      const isValid = extractedGrantedGroupIdsForAccessScope.every(groupId => ownerUserGroupIds.includes(groupId));
      if (!isValid) {
        throw new Error('A userGroup to which the owner does not belong is specified in grantedGroupsForAccessScope');
      }
    }
  }

  async isAiAssistantUsable(aiAssistantId: string, user: IUserHasId): Promise<boolean> {
    const aiAssistant = await AiAssistantModel.findOne({ _id: { $eq: aiAssistantId } });

    if (aiAssistant == null) {
      throw createError(404, 'AiAssistant document does not exist');
    }

    const isOwner = getIdStringForRef(aiAssistant.owner) === getIdStringForRef(user._id);

    if (aiAssistant.shareScope === AiAssistantShareScope.PUBLIC_ONLY) {
      return true;
    }

    if ((aiAssistant.shareScope === AiAssistantShareScope.OWNER) && isOwner) {
      return true;
    }

    if ((aiAssistant.shareScope === AiAssistantShareScope.SAME_AS_ACCESS_SCOPE) && (aiAssistant.accessScope === AiAssistantAccessScope.OWNER) && isOwner) {
      return true;
    }

    if ((aiAssistant.shareScope === AiAssistantShareScope.GROUPS)
      || ((aiAssistant.shareScope === AiAssistantShareScope.SAME_AS_ACCESS_SCOPE) && (aiAssistant.accessScope === AiAssistantAccessScope.GROUPS))) {
      const userGroupIds = [
        ...(await UserGroupRelation.findAllUserGroupIdsRelatedToUser(user)),
        ...(await ExternalUserGroupRelation.findAllUserGroupIdsRelatedToUser(user)),
      ].map(group => group.toString());

      const grantedGroupIdsForShareScope = aiAssistant.grantedGroupsForShareScope?.map(group => getIdStringForRef(group.item)) ?? [];
      const isShared = userGroupIds.some(userGroupId => grantedGroupIdsForShareScope.includes(userGroupId));
      return isShared;
    }

    return false;
  }

  async createAiAssistant(data: UpsertAiAssistantData, user: IUserHasId): Promise<AiAssistantDocument> {
    await this.validateGrantedUserGroupsForAiAssistant(
      user,
      data.shareScope,
      data.accessScope,
      data.grantedGroupsForShareScope,
      data.grantedGroupsForAccessScope,
    );

    const conditions = await this.createConditionForCreateVectorStoreFile(
      user,
      data.accessScope,
      data.grantedGroupsForAccessScope,
      data.pagePathPatterns,
    );

    const vectorStoreRelation = await this.createVectorStore(data.name);
    const aiAssistant = await AiAssistantModel.create({
      ...data, owner: user, vectorStore: vectorStoreRelation,
    });

    // VectorStore creation process does not await
    this.createVectorStoreFileWithStream(vectorStoreRelation, conditions);

    return aiAssistant;
  }

  async updateAiAssistant(aiAssistantId: string, data: UpsertAiAssistantData, user: IUserHasId): Promise<AiAssistantDocument> {
    const aiAssistant = await AiAssistantModel.findOne({ owner: user, _id: aiAssistantId });
    if (aiAssistant == null) {
      throw createError(404, 'AiAssistant document does not exist');
    }

    await this.validateGrantedUserGroupsForAiAssistant(
      user,
      data.shareScope,
      data.accessScope,
      data.grantedGroupsForShareScope,
      data.grantedGroupsForAccessScope,
    );

    const grantedGroupIdsForAccessScopeFromReq = data.grantedGroupsForAccessScope?.map(group => getIdStringForRef(group.item)) ?? []; // ObjectId[] -> string[]
    const grantedGroupIdsForAccessScopeFromDb = aiAssistant.grantedGroupsForAccessScope?.map(group => getIdStringForRef(group.item)) ?? []; // ObjectId[] -> string[]

    // If accessScope, pagePathPatterns, grantedGroupsForAccessScope have not changed, do not build VectorStore
    const shouldRebuildVectorStore = data.accessScope !== aiAssistant.accessScope
      || !isDeepEquals(data.pagePathPatterns, aiAssistant.pagePathPatterns)
      || !isDeepEquals(grantedGroupIdsForAccessScopeFromReq, grantedGroupIdsForAccessScopeFromDb);

    let newVectorStoreRelation: VectorStoreDocument | undefined;
    if (shouldRebuildVectorStore) {
      const conditions = await this.createConditionForCreateVectorStoreFile(
        user,
        data.accessScope,
        data.grantedGroupsForAccessScope,
        data.pagePathPatterns,
      );

      // Delete obsoleted VectorStore
      const obsoletedVectorStoreRelationId = getIdStringForRef(aiAssistant.vectorStore);
      await this.deleteVectorStore(obsoletedVectorStoreRelationId);

      newVectorStoreRelation = await this.createVectorStore(data.name);

      this.updateThreads(aiAssistantId, newVectorStoreRelation.vectorStoreId);

      // VectorStore creation process does not await
      this.createVectorStoreFileWithStream(newVectorStoreRelation, conditions);
    }

    const newData = {
      ...data,
      vectorStore: newVectorStoreRelation ?? aiAssistant.vectorStore,
    };

    aiAssistant.set({ ...newData });
    let updatedAiAssistant: AiAssistantDocument = await aiAssistant.save();

    if (data.shareScope !== AiAssistantShareScope.PUBLIC_ONLY && aiAssistant.isDefault) {
      updatedAiAssistant = await AiAssistantModel.setDefault(aiAssistant._id, false);
    }

    return updatedAiAssistant;
  }

  async getAccessibleAiAssistants(user: IUserHasId): Promise<AccessibleAiAssistants> {
    const userGroupIds = [
      ...(await UserGroupRelation.findAllUserGroupIdsRelatedToUser(user)),
      ...(await ExternalUserGroupRelation.findAllUserGroupIdsRelatedToUser(user)),
    ];

    const assistants = await AiAssistantModel.find({
      $or: [
        // Case 1: Assistants owned by the user
        { owner: user },

        // Case 2: Public assistants owned by others
        {
          $and: [
            { owner: { $ne: user } },
            { shareScope: AiAssistantShareScope.PUBLIC_ONLY },
          ],
        },

        // Case 3: Group-restricted assistants where user is in granted groups
        {
          $and: [
            { owner: { $ne: user } },
            { shareScope: AiAssistantShareScope.GROUPS },
            { 'grantedGroupsForShareScope.item': { $in: userGroupIds } },
          ],
        },
      ],
    })
      .populate('grantedGroupsForShareScope.item')
      .populate('grantedGroupsForAccessScope.item');

    return {
      myAiAssistants: assistants.filter(assistant => assistant.owner.toString() === user._id.toString()) ?? [],
      teamAiAssistants: assistants.filter(assistant => assistant.owner.toString() !== user._id.toString()) ?? [],
    };
  }

  async isLearnablePageLimitExceeded(user: IUserHasId, pagePathPatterns: string[]): Promise<boolean> {
    const normalizedPagePathPatterns = removeGlobPath(pagePathPatterns);

    const PageModel = mongoose.model<IPage, PageModel>('Page');
    const pagePathsWithDescendantCount = await PageModel.descendantCountByPaths(normalizedPagePathPatterns, user, null, true, true);

    const totalPageCount = pagePathsWithDescendantCount.reduce((total, pagePathWithDescendantCount) => {
      const descendantCount = pagePathPatterns.includes(pagePathWithDescendantCount.path)
        ? 0 // Treat as single page when included in "pagePathPatterns"
        : pagePathWithDescendantCount.descendantCount;

      const pageCount = descendantCount + 1;
      return total + pageCount;
    }, 0);

    logger.debug('TotalPageCount: ', totalPageCount);

    const limitLearnablePageCountPerAssistant = configManager.getConfig('openai:limitLearnablePageCountPerAssistant');
    return totalPageCount > limitLearnablePageCountPerAssistant;
  }

  async findAiAssistantByPagePath(
      pagePaths: string[], options?: { shouldPopulateOwner?: boolean, shouldPopulateVectorStore?: boolean },
  ): Promise<AiAssistantDocument[]> {

    const pagePathsWithGlobPattern = pagePaths.map(pagePath => generateGlobPatterns(pagePath)).flat();

    const query = AiAssistantModel.find({
      $or: [
        // Case 1: Exact match
        { pagePathPatterns: { $in: pagePaths } },
        // Case 2: Glob pattern match
        { pagePathPatterns: { $in: pagePathsWithGlobPattern } },
      ],
    });

    if (options?.shouldPopulateOwner) {
      query.populate('owner');
    }

    if (options?.shouldPopulateVectorStore) {
      query.populate('vectorStore');
    }

    const aiAssistants = await query.exec();
    return aiAssistants;
  }

}

let instance: OpenaiService;
export const getOpenaiService = (): IOpenaiService | undefined => {
  if (instance != null) {
    return instance;
  }

  const aiEnabled = configManager.getConfig('app:aiEnabled');
  const openaiServiceType = configManager.getConfig('openai:serviceType');
  if (aiEnabled && openaiServiceType != null && OpenaiServiceTypes.includes(openaiServiceType)) {
    instance = new OpenaiService();
    return instance;
  }

  return;
};
