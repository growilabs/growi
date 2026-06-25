import { type Document, type Model, Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

import type { IContribution } from '../../interfaces/contribution';

export interface ContributionDocument extends IContribution, Document {}
interface ContributionModel extends Model<ContributionDocument> {}

const contributionSchema = new Schema<ContributionDocument>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    count: {
      type: Number,
      default: 1,
    },
  },
  {
    timestamps: {
      createdAt: true,
      updatedAt: true,
    },
  },
);

contributionSchema.index({ user: 1, date: 1 }, { unique: true });

export default getOrCreateModel<ContributionDocument, ContributionModel>(
  'Contribution',
  contributionSchema,
);
