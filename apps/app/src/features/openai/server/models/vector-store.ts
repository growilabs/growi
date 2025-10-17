import { type Document, type Model, Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

import type { IVectorStore } from '../../interfaces/vector-store';

export interface VectorStoreDocument extends IVectorStore, Document {
  markAsDeleted(): Promise<void>;
}

type VectorStoreModel = Model<VectorStoreDocument>;

const schema = new Schema<VectorStoreDocument, VectorStoreModel>({
  vectorStoreId: {
    type: String,
    required: true,
    unique: true,
  },
  isDeleted: {
    type: Boolean,
    default: false,
    required: true,
  },
});

schema.methods.markAsDeleted = async function (): Promise<void> {
  this.isDeleted = true;
  await this.save();
};

export default getOrCreateModel<VectorStoreDocument, VectorStoreModel>(
  'VectorStore',
  schema,
);
