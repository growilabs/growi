import type { PlatformName } from '@growi/chat';
import { addMinutes } from 'date-fns/addMinutes';
import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

/**
 * Default lifetime of a one-time account-link order (Requirement 7.3).
 * Modeled after `models/password-reset-order.ts`'s `expiredAt()` default.
 */
export const ACCOUNT_LINK_ORDER_DEFAULT_MINUTES = 10;

const defaultExpiredAt = (): Date =>
  addMinutes(new Date(), ACCOUNT_LINK_ORDER_DEFAULT_MINUTES);

export interface IChatAccountLinkOrder {
  /** One-time token embedded in the link sent to the chat user. */
  token: string;
  relationId: string;
  platform: PlatformName;
  accountId: string;
  isRevoked: boolean;
  createdAt: Date;
  expiredAt: Date;
}

export interface ChatAccountLinkOrderDocument
  extends IChatAccountLinkOrder,
    Document {}

export interface ChatAccountLinkOrderModel
  extends Model<ChatAccountLinkOrderDocument> {}

const chatAccountLinkOrderSchema = new Schema<
  ChatAccountLinkOrderDocument,
  ChatAccountLinkOrderModel
>(
  {
    token: { type: String, required: true },
    relationId: { type: String, required: true },
    platform: {
      type: String,
      enum: [
        'slack',
        'discord',
        'teams',
        'mattermost',
      ] satisfies PlatformName[],
      required: true,
    },
    accountId: { type: String, required: true },
    isRevoked: { type: Boolean, required: true, default: false },
    createdAt: { type: Date, required: true, default: () => new Date() },
    expiredAt: { type: Date, required: true, default: defaultExpiredAt },
  },
  {
    collection: 'chat_account_link_orders',
    timestamps: false,
  },
);

chatAccountLinkOrderSchema.index({ token: 1 }, { unique: true });
chatAccountLinkOrderSchema.index({ expiredAt: 1 }, { expireAfterSeconds: 0 });

export const ChatAccountLinkOrder = getOrCreateModel<
  ChatAccountLinkOrderDocument,
  ChatAccountLinkOrderModel
>('ChatAccountLinkOrder', chatAccountLinkOrderSchema);
