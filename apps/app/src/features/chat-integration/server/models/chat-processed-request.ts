import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

/**
 * Retention period for chat_processed_requests documents, in seconds.
 * 24 hours -- the window during which the proxy may plausibly retry the
 * same `CommandRequest` (Requirement 10.4).
 */
export const PROCESSED_REQUEST_TTL_SECONDS = 24 * 60 * 60;

export interface IChatProcessedRequest {
  relationId: string;
  requestId: string;
  /** The `CommandResponse` returned the first time; replayed verbatim on retry. */
  response: unknown;
  processedAt: Date;
}

export interface ChatProcessedRequestDocument
  extends IChatProcessedRequest,
    Document {}

export interface ChatProcessedRequestModel
  extends Model<ChatProcessedRequestDocument> {}

const chatProcessedRequestSchema = new Schema<
  ChatProcessedRequestDocument,
  ChatProcessedRequestModel
>(
  {
    relationId: { type: String, required: true },
    requestId: { type: String, required: true },
    response: { type: Schema.Types.Mixed, required: true },
    processedAt: { type: Date, required: true, default: () => new Date() },
  },
  {
    collection: 'chat_processed_requests',
    timestamps: false,
  },
);

// `requestId` alone is not unique across relations -- see design.md's note
// on the same pitfall for `keyId` -- so the de-duplication key is the pair.
chatProcessedRequestSchema.index(
  { relationId: 1, requestId: 1 },
  { unique: true },
);

chatProcessedRequestSchema.index(
  { processedAt: 1 },
  { expireAfterSeconds: PROCESSED_REQUEST_TTL_SECONDS },
);

export const ChatProcessedRequest = getOrCreateModel<
  ChatProcessedRequestDocument,
  ChatProcessedRequestModel
>('ChatProcessedRequest', chatProcessedRequestSchema);
