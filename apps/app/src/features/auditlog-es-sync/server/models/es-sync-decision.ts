import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

import { WINDOW_TTL_SECONDS } from './window-ttl';

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
  // When the current claim was last touched (created, stolen, reconfirmed, or
  // finalized) — refreshed on every write, not just the initial claim. Doubles as:
  // (1) the staleness check for 'pending' claims (a claim older than
  //     STALE_CLAIM_MS is assumed abandoned and may be taken over), and
  // (2) the TTL anchor (see below) — windowStart cannot be the TTL field, since
  //     it is keyed off the event's own createdAt and a backlog replay would
  //     carry an old windowStart, expiring the document almost immediately.
  claimedAt: Date;
  // Fencing token identifying the current claim holder. Every write a claimant makes
  // (the counter $inc, the final decision write) is conditioned on this token still
  // matching, so a claimant that stalled long enough for another process to steal the
  // claim detects the loss instead of blindly acting as if it still owned it.
  claimToken: string;
}

export interface EsSyncDecisionModel extends Model<EsSyncDecisionDocument> {}

const schema = new Schema<EsSyncDecisionDocument, EsSyncDecisionModel>({
  _id: { type: String, required: true },
  endpoint: { type: String, required: true },
  windowStart: { type: Date, required: true },
  decision: {
    type: String,
    enum: ['pending', 'admitted', 'dropped'],
    required: true,
  },
  claimedAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: WINDOW_TTL_SECONDS },
  },
  claimToken: { type: String, required: true },
});

export const EsSyncDecision = getOrCreateModel<
  EsSyncDecisionDocument,
  EsSyncDecisionModel
>('EsSyncDecision', schema);
