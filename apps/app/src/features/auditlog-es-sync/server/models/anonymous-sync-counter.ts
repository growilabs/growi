import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

// One window is 60s; expire a bit after it closes so a straggler process can still
// read the final count (e.g. for the sliding-window boundary check) before cleanup.
const WINDOW_TTL_SECONDS = 120;

export interface AnonymousSyncCounterDocument extends Document {
  endpoint: string;
  windowStart: Date;
  // Incremented at most once per distinct anonymous-log event for this
  // (endpoint, windowStart) — see decide-es-sync-for-event.ts, which owns the
  // increment. Never $inc this from anywhere else, or duplicate change-stream
  // processing across GROWI processes will double-count the same event.
  count: number;
}

export interface AnonymousSyncCounterModel
  extends Model<AnonymousSyncCounterDocument> {}

const schema = new Schema<
  AnonymousSyncCounterDocument,
  AnonymousSyncCounterModel
>({
  endpoint: { type: String, required: true },
  windowStart: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: WINDOW_TTL_SECONDS },
  },
  count: { type: Number, required: true, default: 0 },
});
schema.index({ endpoint: 1, windowStart: 1 }, { unique: true });

export const AnonymousSyncCounter = getOrCreateModel<
  AnonymousSyncCounterDocument,
  AnonymousSyncCounterModel
>('AnonymousSyncCounter', schema);
