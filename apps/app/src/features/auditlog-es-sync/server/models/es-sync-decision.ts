import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

// Mirrors AnonymousSyncCounter's window lifetime: a decision only matters while
// its window is still being gated, so it can expire alongside the counter.
const WINDOW_TTL_SECONDS = 120;

export type EsSyncDecisionValue = 'pending' | 'admitted' | 'dropped';

export interface EsSyncDecisionDocument extends Document {
  // The anonymous log's own activity._id (as a string), reused as this
  // document's _id. Its uniqueness is what makes "first insert wins" work:
  // exactly one process's create() succeeds per event, everyone else hits a
  // duplicate-key error and reads this document instead of writing to it.
  _id: string;
  endpoint: string;
  windowStart: Date;
  decision: EsSyncDecisionValue;
  // When the current 'pending' claim was taken. A claim older than the stale
  // threshold (see decide-es-sync-for-event.ts) is assumed abandoned (the
  // claiming process crashed or stalled) and may be taken over.
  claimedAt: Date;
}

export interface EsSyncDecisionModel extends Model<EsSyncDecisionDocument> {}

const schema = new Schema<EsSyncDecisionDocument, EsSyncDecisionModel>({
  _id: { type: String, required: true },
  endpoint: { type: String, required: true },
  windowStart: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: WINDOW_TTL_SECONDS },
  },
  decision: {
    type: String,
    enum: ['pending', 'admitted', 'dropped'],
    required: true,
  },
  claimedAt: { type: Date, required: true },
});

export const EsSyncDecision = getOrCreateModel<
  EsSyncDecisionDocument,
  EsSyncDecisionModel
>('EsSyncDecision', schema);
