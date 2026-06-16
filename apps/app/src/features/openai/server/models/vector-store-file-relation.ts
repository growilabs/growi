import type mongoose from 'mongoose';
import type { Types } from 'mongoose';
import { type Document, type Model, Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

export interface VectorStoreFileRelation {
  vectorStoreRelationId: mongoose.Types.ObjectId;
  page: mongoose.Types.ObjectId;
  attachment?: mongoose.Types.ObjectId;
  fileIds: string[];
  isAttachedToVectorStore: boolean;
}

interface VectorStoreFileRelationDocument
  extends VectorStoreFileRelation,
    Document {}

interface VectorStoreFileRelationModel extends Model<VectorStoreFileRelation> {
  upsertVectorStoreFileRelations(
    vectorStoreFileRelations: VectorStoreFileRelation[],
  ): Promise<void>;
  markAsAttachedToVectorStore(pageIds: Types.ObjectId[]): Promise<void>;
}

export const prepareVectorStoreFileRelations = (
  vectorStoreRelationId: Types.ObjectId,
  page: Types.ObjectId,
  fileId: string,
  relationsMap: Map<string, VectorStoreFileRelation>,
  attachment?: Types.ObjectId,
): Map<string, VectorStoreFileRelation> => {
  const key = (() => {
    if (attachment == null) {
      return page.toHexString();
    }
    return page.toHexString() + attachment.toHexString();
  })();

  const existingData = relationsMap.get(key);

  // If the data exists, add the fileId to the fileIds array
  if (existingData != null) {
    existingData.fileIds.push(fileId);
  }
  // If the data doesn't exist, create a new one and add it to the map
  else {
    relationsMap.set(key, {
      vectorStoreRelationId,
      page,
      fileIds: [fileId],
      isAttachedToVectorStore: false,
      attachment,
    });
  }

  return relationsMap;
};

const schema = new Schema<
  VectorStoreFileRelationDocument,
  VectorStoreFileRelationModel
>({
  vectorStoreRelationId: {
    type: Schema.Types.ObjectId,
    ref: 'VectorStore',
    required: true,
  },
  page: {
    type: Schema.Types.ObjectId,
    ref: 'Page',
    required: true,
  },
  attachment: {
    type: Schema.Types.ObjectId,
    ref: 'Attachment',
  },
  fileIds: [
    {
      type: String,
      required: true,
    },
  ],
  isAttachedToVectorStore: {
    type: Boolean,
    default: false, // File is not attached to the Vector Store at the time it is uploaded
    required: true,
  },
});

// define unique compound index
schema.index(
  { vectorStoreRelationId: 1, page: 1, attachment: 1 },
  { unique: true },
);

schema.statics.upsertVectorStoreFileRelations = async function (
  vectorStoreFileRelations: VectorStoreFileRelation[],
): Promise<void> {
  const upsertOps = vectorStoreFileRelations
    .filter((data) => data.attachment == null)
    .map((data) => ({
      updateOne: {
        filter: {
          page: data.page,
          vectorStoreRelationId: data.vectorStoreRelationId,
          attachment: { $exists: false },
        },
        update: {
          $addToSet: { fileIds: { $each: data.fileIds } },
        },
        upsert: true,
      },
    }));

  const insertOps = vectorStoreFileRelations
    .filter((data) => data.attachment != null)
    .map((data) => ({
      insertOne: {
        document: {
          vectorStoreRelationId: data.vectorStoreRelationId,
          page: data.page,
          attachment: data.attachment,
          fileIds: data.fileIds,
          isAttachedToVectorStore: data.isAttachedToVectorStore,
        },
      },
    }));

  const bulkOps = [...upsertOps, ...insertOps];
  if (bulkOps.length > 0) {
    await this.bulkWrite(bulkOps);
  }
};

// Used when attached to VectorStore
schema.statics.markAsAttachedToVectorStore = async function (
  pageIds: Types.ObjectId[],
): Promise<void> {
  await this.updateMany(
    { page: { $in: pageIds } },
    { $set: { isAttachedToVectorStore: true } },
  );
};

export default getOrCreateModel<
  VectorStoreFileRelationDocument,
  VectorStoreFileRelationModel
>('VectorStoreFileRelation', schema);
