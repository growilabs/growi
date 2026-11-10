import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

import { isEncryptedChatKeyEnvelope } from '../key-encryption';

/**
 * 'own' -- this GROWI's own signing key, sent to the proxy.
 * 'peer' -- the proxy's public key, used to verify incoming requests.
 */
export type ChatIntegrationKeySide = 'own' | 'peer';

export interface IChatIntegrationKey {
  relationId: string;
  side: ChatIntegrationKeySide;
  keyId: string;
  /**
   * Serialized key material.
   *
   * For `side: 'own'` this is the private key encrypted for storage by
   * `encryptChatKeyForStorage` (design.md "秘密鍵の暗号化は GROWI に前例が無い
   * ので、この spec が仕組みごと決める"), and the schema refuses any other
   * form -- see the validator below. For `side: 'peer'` it is the proxy's
   * public key, which is not a secret and is stored as it arrived.
   */
  key: string;
  validFrom: Date;
  /** Null while the key is still valid. */
  revokedAt: Date | null;
}

export interface ChatIntegrationKeyDocument
  extends IChatIntegrationKey,
    Document {}

export interface ChatIntegrationKeyModel
  extends Model<ChatIntegrationKeyDocument> {}

const chatIntegrationKeySchema = new Schema<
  ChatIntegrationKeyDocument,
  ChatIntegrationKeyModel
>(
  {
    relationId: { type: String, required: true },
    side: {
      type: String,
      enum: ['own', 'peer'] satisfies ChatIntegrationKeySide[],
      required: true,
    },
    keyId: { type: String, required: true },
    key: {
      type: String,
      required: true,
      validate: {
        // An own-side private key must already be encrypted by the time it
        // reaches the database (design.md "平文で保存に落とさない"). Peer keys
        // are public, so they are stored as they arrived.
        //
        // This only fires on a document-path write (`save`/`create`): on an
        // `updateOne`/`findOneAndUpdate`-style write, Mongoose binds `this`
        // to the Query rather than the document, so `side` is unreadable
        // here and the check silently passes anything through. Own-side key
        // writes must go through `save`/`create` to stay guarded by this
        // validator.
        validator: function (
          this: { side?: ChatIntegrationKeySide },
          value: string,
        ): boolean {
          if (this?.side !== 'own') {
            return true;
          }
          return isEncryptedChatKeyEnvelope(value);
        },
        message:
          'An own-side key must be encrypted by encryptChatKeyForStorage before it is stored.',
      },
    },
    validFrom: { type: Date, required: true, default: () => new Date() },
    revokedAt: { type: Date, default: null },
  },
  {
    collection: 'chat_integration_keys',
    timestamps: false,
  },
);

// A `keyId` alone can collide across relations (design.md "鍵の識別子も
// `(relationId, keyId)` の組で扱う"); `side` is added because own/peer keys
// are minted independently and could otherwise share a keyId value.
chatIntegrationKeySchema.index(
  { relationId: 1, side: 1, keyId: 1 },
  { unique: true },
);

export const ChatIntegrationKey = getOrCreateModel<
  ChatIntegrationKeyDocument,
  ChatIntegrationKeyModel
>('ChatIntegrationKey', chatIntegrationKeySchema);
