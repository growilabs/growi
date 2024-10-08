import assert from 'node:assert';
import { Readable, Transform } from 'stream';

import { PageGrant, isPopulated } from '@growi/core';
import type { HydratedDocument, Types } from 'mongoose';
import mongoose from 'mongoose';
import type OpenAI from 'openai';
import { toFile } from 'openai';

import VectorStoreFileRelationModel, {
  type VectorStoreFileRelation,
  prepareVectorStoreFileRelations,
} from '~/features/openai/server/models/vector-store-file-relation';
import { OpenaiServiceTypes } from '~/interfaces/ai';
import type { PageDocument, PageModel } from '~/server/models/page';
import { configManager } from '~/server/service/config-manager';
import { createBatchStream } from '~/server/util/batch-stream';
import loggerFactory from '~/utils/logger';


import { getClient } from './client-delegator';

const BATCH_SIZE = 100;

const logger = loggerFactory('growi:service:openai');


export interface IOpenaiService {
  createVectorStoreFile(pages: PageDocument[]): Promise<void>;
  rebuildVectorStoreAll(): Promise<void>;
  rebuildVectorStore(page: PageDocument): Promise<void>;
}
class OpenaiService implements IOpenaiService {

  private get client() {
    const openaiServiceType = configManager.getConfig('crowi', 'app:openaiServiceType');
    return getClient({ openaiServiceType });
  }

  private async uploadFile(pageId: Types.ObjectId, body: string): Promise<OpenAI.Files.FileObject> {
    const file = await toFile(Readable.from(body), `${pageId}.md`);
    const uploadedFile = await this.client.uploadFile(file);
    return uploadedFile;
  }

  async createVectorStoreFile(pages: Array<PageDocument>): Promise<void> {
    const preparedVectorStoreFileRelations: VectorStoreFileRelation[] = [];
    const processUploadFile = async(page: PageDocument) => {
      if (page._id != null && page.grant === PageGrant.GRANT_PUBLIC && page.revision != null) {
        if (isPopulated(page.revision) && page.revision.body.length > 0) {
          const uploadedFile = await this.uploadFile(page._id, page.revision.body);
          prepareVectorStoreFileRelations(page._id, uploadedFile.id, preparedVectorStoreFileRelations);
          return;
        }

        const pagePopulatedToShowRevision = await page.populateDataToShowRevision();
        if (pagePopulatedToShowRevision.revision != null && pagePopulatedToShowRevision.revision.body.length > 0) {
          const uploadedFile = await this.uploadFile(page._id, pagePopulatedToShowRevision.revision.body);
          prepareVectorStoreFileRelations(page._id, uploadedFile.id, preparedVectorStoreFileRelations);
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

    try {
      // Create vector store file
      const uploadedFileIds = preparedVectorStoreFileRelations.map(data => data.fileIds).flat();
      const createVectorStoreFileBatchResponse = await this.client.createVectorStoreFileBatch(uploadedFileIds);
      logger.debug('Create vector store file', createVectorStoreFileBatchResponse);

      // Save vector store file relation
      await VectorStoreFileRelationModel.upsertVectorStoreFileRelations(preparedVectorStoreFileRelations);
    }
    catch (err) {
      logger.error(err);
    }

  }

  private async deleteVectorStoreFile(page: PageDocument): Promise<void> {
    // Delete vector store file and delete vector store file relation
    const vectorStoreFileRelation = await VectorStoreFileRelationModel.findOne({ pageId: page._id });
    if (vectorStoreFileRelation != null) {
      const deletedFileIds: string[] = [];
      for (const fileId of vectorStoreFileRelation.fileIds) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const deleteFileResponse = await this.client.deleteFile(fileId);
          logger.debug('Delete vector store file', deleteFileResponse);
          deletedFileIds.push(fileId);
        }
        catch (err) {
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
  }

  async rebuildVectorStoreAll() {
    // TODO: https://redmine.weseek.co.jp/issues/154364

    // Create all public pages VectorStoreFile
    const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>('Page');
    const pagesStream = Page.find({ grant: PageGrant.GRANT_PUBLIC }).populate('revision').cursor({ batch_size: BATCH_SIZE });
    const batchStrem = createBatchStream(BATCH_SIZE);

    const createVectorStoreFile = this.createVectorStoreFile.bind(this);
    const createVectorStoreFileStream = new Transform({
      objectMode: true,
      async transform(chunk: PageDocument[], encoding, callback) {
        await createVectorStoreFile(chunk);
        this.push(chunk);
        callback();
      },
    });

    pagesStream
      .pipe(batchStrem)
      .pipe(createVectorStoreFileStream);
  }

  async rebuildVectorStore(page: PageDocument) {
    await this.deleteVectorStoreFile(page);
    await this.createVectorStoreFile([page]);
  }

}

let instance: OpenaiService;
export const getOpenaiService = (): IOpenaiService | undefined => {
  if (instance != null) {
    return instance;
  }

  const aiEnabled = configManager.getConfig('crowi', 'app:aiEnabled');
  const openaiServiceType = configManager.getConfig('crowi', 'app:openaiServiceType');
  if (aiEnabled && openaiServiceType != null && OpenaiServiceTypes.includes(openaiServiceType)) {
    instance = new OpenaiService();
    return instance;
  }

  return;
};
