import type { PlatformName } from '@growi/chat';
import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

export interface IChatNotificationDestination {
  relationId: string;

  platform: PlatformName;

  /** The only field ever used to match a channel (never `channelName`). */
  channelId: string;

  /**
   * Display-only, may drift from the chat platform's current name. Refreshed
   * whenever `ChannelInventory` is re-fetched so the admin screen's
   * Requirement 12.4 staleness check has an up-to-date value to compare
   * against.
   */
  channelName: string;

  /** Page-path glob this destination is scoped to. */
  pathPattern: string;

  /** Event names this destination should receive notifications for. */
  triggerEvents: string[];
}

export interface ChatNotificationDestinationDocument
  extends IChatNotificationDestination,
    Document {}

export interface ChatNotificationDestinationModel
  extends Model<ChatNotificationDestinationDocument> {}

const chatNotificationDestinationSchema = new Schema<
  ChatNotificationDestinationDocument,
  ChatNotificationDestinationModel
>(
  {
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
    channelId: { type: String, required: true },
    channelName: { type: String, required: true },
    pathPattern: { type: String, required: true },
    triggerEvents: { type: [String], required: true, default: [] },
  },
  {
    collection: 'chat_notification_destinations',
    timestamps: false,
  },
);

// No index/TTL is specified for this collection in design.md's Data Models
// table -- it is a small, admin-managed configuration set, always queried
// alongside its owning relation, so no dedicated index is added here.

export const ChatNotificationDestination = getOrCreateModel<
  ChatNotificationDestinationDocument,
  ChatNotificationDestinationModel
>('ChatNotificationDestination', chatNotificationDestinationSchema);
