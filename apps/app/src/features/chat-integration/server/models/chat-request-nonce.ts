import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

export interface IChatRequestNonce {
  relationId: string;
  /**
   * Paired with `relationId` -- a `keyId` alone can collide across
   * relations (design.md "鍵の識別子も `(relationId, keyId)` の組で扱う").
   */
  keyId: string;
  nonce: string;
  expiresAt: Date;
}

export interface ChatRequestNonceDocument extends IChatRequestNonce, Document {}

export interface ChatRequestNonceModel
  extends Model<ChatRequestNonceDocument> {}

const chatRequestNonceSchema = new Schema<
  ChatRequestNonceDocument,
  ChatRequestNonceModel
>(
  {
    relationId: { type: String, required: true },
    keyId: { type: String, required: true },
    nonce: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  {
    collection: 'chat_request_nonces',
    timestamps: false,
  },
);

chatRequestNonceSchema.index(
  { relationId: 1, keyId: 1, nonce: 1 },
  { unique: true },
);

// TTL: expireAfterSeconds: 0 removes a document exactly at its own
// `expiresAt` value, rather than N seconds after some other timestamp.
chatRequestNonceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ChatRequestNonce = getOrCreateModel<
  ChatRequestNonceDocument,
  ChatRequestNonceModel
>('ChatRequestNonce', chatRequestNonceSchema);
