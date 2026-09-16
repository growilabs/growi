import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

import { WINDOW_TTL_SECONDS } from './window-ttl';

export interface AnonymousSyncCounterDocument extends Document {
  endpoint: string;
  windowStart: Date;
  // Incremented at most once per distinct anonymous-log event for this
  // (endpoint, windowStart) — see decide-es-sync-for-event.ts, which owns the
  // increment. Never $inc this from anywhere else, or duplicate change-stream
  // processing across GROWI processes will double-count the same event.
  count: number;
  // TTL anchor, refreshed on every write to this document (not just creation).
  // windowStart cannot be the TTL field: it is keyed off each event's own
  // createdAt (see filterAdmittedUpserts), so a backlog replayed long after the
  // fact would carry an old windowStart and expire almost immediately if the TTL
  // were keyed on it. Refreshing on every write also means a backlog replay that
  // takes longer than WINDOW_TTL_SECONDS to catch up keeps its counter alive for
  // as long as it keeps receiving writes, instead of expiring mid-replay.
  updatedAt: Date;
}

export interface AnonymousSyncCounterModel
  extends Model<AnonymousSyncCounterDocument> {}

const schema = new Schema<
  AnonymousSyncCounterDocument,
  AnonymousSyncCounterModel
>({
  endpoint: { type: String, required: true },
  windowStart: { type: Date, required: true },
  count: { type: Number, required: true, default: 0 },
  updatedAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: WINDOW_TTL_SECONDS },
  },
});
schema.index({ endpoint: 1, windowStart: 1 }, { unique: true });

export const AnonymousSyncCounter = getOrCreateModel<
  AnonymousSyncCounterDocument,
  AnonymousSyncCounterModel
>('AnonymousSyncCounter', schema);
