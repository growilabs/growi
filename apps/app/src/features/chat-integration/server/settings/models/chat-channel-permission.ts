import type { CommandName } from '@growi/chat';
import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

/**
 * Which channels a command is allowed in, as a value this schema can store.
 *
 * The wire contract (`RelationSettings.channelPermissions[].allowedChannels`
 * in `@growi/chat`) is a union: `'all'` (every channel), `'none'` (no
 * channel), or an explicit list of channel ids. A Mongoose path cannot hold
 * that union without `Schema.Types.Mixed`, and `Mixed` would cost the two
 * things that matter most here -- the enum check that keeps an unknown
 * scope out of storage, and reliable change tracking (a `Mixed` path needs
 * `markModified` and silently keeps the old value without it). So the union
 * is stored decomposed: this discriminator, plus the id list that only
 * `'listed'` gives meaning to.
 *
 * The translation both ways lives in ONE place --
 * `settings/allowed-channels.ts` -- so no reader has to know this encoding.
 */
export type ChatChannelPermissionScope = 'all' | 'none' | 'listed';

export interface IChatChannelPermission {
  relationId: string;
  commandName: CommandName;
  /**
   * `'listed'` means "look at `allowedChannels`"; `'all'`/`'none'` answer on
   * their own and leave `allowedChannels` empty.
   */
  channelScope: ChatChannelPermissionScope;
  /**
   * Channel ids this command is allowed to run from, for this relation --
   * meaningful only while `channelScope` is `'listed'`.
   * `relationId` already pins the platform (one platform per relation), so
   * no separate platform field is needed per channel entry.
   */
  allowedChannels: string[];
}

export interface ChatChannelPermissionDocument
  extends IChatChannelPermission,
    Document {}

export interface ChatChannelPermissionModel
  extends Model<ChatChannelPermissionDocument> {}

const chatChannelPermissionSchema = new Schema<
  ChatChannelPermissionDocument,
  ChatChannelPermissionModel
>(
  {
    relationId: { type: String, required: true },
    commandName: { type: String, required: true },
    channelScope: {
      type: String,
      enum: ['all', 'none', 'listed'] satisfies ChatChannelPermissionScope[],
      required: true,
      // A row written before this field existed carried only an explicit id
      // list, so 'listed' is the reading that preserves what it meant.
      default: 'listed',
    },
    allowedChannels: { type: [String], required: true, default: [] },
  },
  {
    collection: 'chat_channel_permissions',
    // No per-row updatedAt: design.md is explicit that the single version
    // counter lives on `chat_relations.settingsVersion` instead, because
    // `SettingsPushRequest.version` is one value per relation, not per row
    // ("行ごとの `updatedAt` は持たない").
    timestamps: false,
  },
);

chatChannelPermissionSchema.index(
  { relationId: 1, commandName: 1 },
  { unique: true },
);

export const ChatChannelPermission = getOrCreateModel<
  ChatChannelPermissionDocument,
  ChatChannelPermissionModel
>('ChatChannelPermission', chatChannelPermissionSchema);
