import mongoose, { type Document, Schema } from 'mongoose';

import type { IContributionCache } from '~/features/contribution-graph/interfaces/contribution-graph';

export interface ContributionGraphDocument
  extends IContributionCache,
    Document {}

const ContributionDaySchema = new Schema(
  {
    date: { type: String, required: true },
    count: { type: Number, required: true },
  },
  { _id: false },
);

/*
 * Schema Definition
 */
const ContributionGraphSchema = new Schema<ContributionGraphDocument>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
    unique: true,
  },
  lastUpdated: {
    type: Date,
    required: true,
  },
  currentWeekData: [ContributionDaySchema],
  permanentWeeks: {
    type: Map,
    of: [ContributionDaySchema],
    default: {},
  },
});

export const ContributionCache = mongoose.model(
  'ContributionCache',
  ContributionGraphSchema,
);
