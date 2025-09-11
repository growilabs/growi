import { addDays } from 'date-fns';
import { type Document, Schema, type PaginateModel } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

import { type IThreadRelation, ThreadType } from '../../interfaces/thread-relation';


const DAYS_UNTIL_EXPIRATION = 3;

const generateExpirationDate = (): Date => {
  return addDays(new Date(), DAYS_UNTIL_EXPIRATION);
};

export interface ThreadRelationDocument extends IThreadRelation, Document {
  updateThreadExpiration(): Promise<void>;
}

interface ThreadRelationModel extends PaginateModel<ThreadRelationDocument> {
  getExpiredThreadRelations(limit?: number): Promise<ThreadRelationDocument[] | undefined>;
  deactivateByAiAssistantId(aiAssistantId: string): Promise<void>;
}

const schema = new Schema<ThreadRelationDocument, ThreadRelationModel>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  aiAssistant: {
    type: Schema.Types.ObjectId,
    ref: 'AiAssistant',
  },
  threadId: {
    type: String,
    required: true,
    unique: true,
  },
  title: {
    type: String,
  },
  type: {
    type: String,
    enum: Object.values(ThreadType),
    required: true,
  },
  expiredAt: {
    type: Date,
    default: generateExpirationDate,
    required: true,
  },
  isActive: {
    type: Boolean,
    default: true,
    required: true,
  },
}, {
  timestamps: { createdAt: false, updatedAt: true },
});

schema.plugin(mongoosePaginate);

schema.statics.getExpiredThreadRelations = async function(limit?: number): Promise<ThreadRelationDocument[] | undefined> {
  const currentDate = new Date();
  const expiredThreadRelations = await this.find({ expiredAt: { $lte: currentDate } }).limit(limit ?? 100).exec();
  return expiredThreadRelations;
};

schema.statics.deactivateByAiAssistantId = async function(aiAssistantId: string): Promise<void> {
  await this.updateMany(
    {
      aiAssistant: aiAssistantId,
      isActive: true,
    },
    {
      $set: { isActive: false },
    },
  );
};


schema.methods.updateThreadExpiration = async function(): Promise<void> {
  this.expiredAt = generateExpirationDate();
  await this.save();
};

export default getOrCreateModel<ThreadRelationDocument, ThreadRelationModel>('ThreadRelation', schema);
