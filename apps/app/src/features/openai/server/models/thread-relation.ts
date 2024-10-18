import type mongoose from 'mongoose';
import { type Model, type Document, Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

const DAYS_UNTIL_EXPIRATION = 30;

const generateExpirationDate = (): Date => {
  const currentDate = new Date();
  const expirationDate = new Date(currentDate.setDate(currentDate.getDate() + DAYS_UNTIL_EXPIRATION));
  return expirationDate;
};

interface ThreadRelation {
  userId: mongoose.Types.ObjectId;
  threadId: string;
  expiredAt: Date;
}

interface ThreadRelationDocument extends ThreadRelation, Document {
  updateThreadExpiration(): Promise<void>;
}

interface ThreadRelationModel extends Model<ThreadRelationDocument> {
  getExpiredThreadRelations(limit?: number): Promise<ThreadRelationDocument[] | undefined>;
}

const schema = new Schema<ThreadRelationDocument, ThreadRelationModel>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  threadId: {
    type: String,
    required: true,
    unique: true,
  },
  expiredAt: {
    type: Date,
    default: generateExpirationDate,
    required: true,
  },
});

schema.statics.getExpiredThreadRelations = async function(limit?: number): Promise<ThreadRelationDocument[] | undefined> {
  const currentDate = new Date();
  const expiredThreadRelations = await this.find({ expiredAt: { $lte: currentDate } }).limit(limit ?? 100).exec();
  return expiredThreadRelations;
};

schema.methods.updateThreadExpiration = async function(): Promise<void> {
  this.expiredAt = generateExpirationDate();
  await this.save();
};

export default getOrCreateModel<ThreadRelationDocument, ThreadRelationModel>('ThreadRelation', schema);
