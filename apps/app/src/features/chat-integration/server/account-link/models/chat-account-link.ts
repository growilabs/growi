import type { PlatformName } from '@growi/chat';
import type mongoose from 'mongoose';
import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

export interface IChatAccountLink {
  relationId: string;
  userId: mongoose.Types.ObjectId;
  platform: PlatformName;
  /**
   * Chat-platform member id. Only unique WITHIN a workspace, so it must
   * never be the sole matching key across relations (design.md "紐付けの
   * 一意性に workspace の軸が要る").
   */
  accountId: string;
  linkedAt: Date;
}

export interface ChatAccountLinkDocument extends IChatAccountLink, Document {}

export interface ChatAccountLinkModel extends Model<ChatAccountLinkDocument> {}

const chatAccountLinkSchema = new Schema<
  ChatAccountLinkDocument,
  ChatAccountLinkModel
>(
  {
    relationId: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
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
    linkedAt: { type: Date, required: true, default: () => new Date() },
  },
  {
    collection: 'chat_account_links',
    timestamps: false,
  },
);

// Requirement 7.4's realization: a workspace-scoped account id must only
// resolve to one GROWI user PER relation. This is the exact index design.md
// spends a whole section justifying -- do not narrow it to (platform,
// accountId), and do not widen it to include relationId alone.
chatAccountLinkSchema.index(
  { relationId: 1, platform: 1, accountId: 1 },
  { unique: true },
);

export const ChatAccountLink = getOrCreateModel<
  ChatAccountLinkDocument,
  ChatAccountLinkModel
>('ChatAccountLink', chatAccountLinkSchema);
