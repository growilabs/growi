import type { PlatformName } from '@growi/chat';
import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

/**
 * Lifecycle state of a GROWI <-> chat-integration-proxy relation.
 *
 * 'unpaired' is written by the unlink flow (Requirement 9.7) instead of
 * deleting the row: `workspaceId`/`platform` must survive so a later
 * re-pairing can recognize and take over the same workspace's account
 * links (design.md "紐付けの一意性に workspace の軸が要る"). Only the
 * keys/channel-permissions/destinations rows are deleted on unlink.
 */
export type ChatRelationState = 'active' | 'unpaired';

export interface IChatRelation {
  /**
   * Opaque identifier minted by the proxy (Decision: never a sequential
   * value -- see protocol spec). The ONLY value every incoming request
   * uses to name a relation, so this is the single-column unique key
   * (design.md "`relationId` は単独で一意にする（複合ユニークにしない）").
   */
  relationId: string;

  /** Base URI of the proxy this relation talks to (`ProxyClient` target). */
  proxyUri: string;

  platform: PlatformName;

  /** Chat-platform workspace identifier. Preserved across unlink/re-pair. */
  workspaceId: string;

  /** Display name of the workspace, shown in the admin screen. */
  workspaceName: string;

  /** Administrator-assigned display label. Null until set. */
  label: string | null;

  state: ChatRelationState;

  /**
   * When `state` became `'unpaired'`; `null` while the relation is active.
   *
   * Two things need it and neither can be derived from `createdAt`:
   * re-pairing has to inherit the account links of the MOST RECENTLY
   * unpaired relation for the same workspace (design.md "引き継ぎ元が複数ある
   * ときは、いちばん新しい解除済みの行から引き継ぐ"), and the 90-day sweep of
   * unpaired rows needs the instant the 90 days are counted from. Not a TTL
   * index: the sweep is the same conditional-update, one-host-only job that
   * `NotificationDispatcher` runs, because it has to remove the relation's
   * `chat_account_links` rows in the same pass.
   */
  unpairedAt: Date | null;

  /**
   * Bumped by one on every settings save (Requirement 11.4). `settings-pull`
   * returns this value so the proxy can tell whether its cached copy is
   * stale.
   */
  settingsVersion: number;

  createdAt: Date;
}

export interface ChatRelationDocument extends IChatRelation, Document {}

export interface ChatRelationModel extends Model<ChatRelationDocument> {}

const chatRelationSchema = new Schema<ChatRelationDocument, ChatRelationModel>(
  {
    relationId: { type: String, required: true },
    proxyUri: { type: String, required: true },
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
    workspaceId: { type: String, required: true },
    workspaceName: { type: String, required: true },
    label: { type: String, default: null },
    state: {
      type: String,
      enum: ['active', 'unpaired'] satisfies ChatRelationState[],
      required: true,
      default: 'active',
    },
    unpairedAt: { type: Date, default: null },
    settingsVersion: { type: Number, required: true, default: 0 },
    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  {
    collection: 'chat_relations',
    // Timestamps are modeled explicitly (createdAt only, no updatedAt column
    // in the design) rather than via Mongoose's automatic timestamps option.
    timestamps: false,
  },
);

// `relationId` MUST stay a single-column unique index, never compound with
// `proxyUri` or anything else -- see design.md "`relationId` は単独で一意に
// する（複合ユニークにしない）" for the security reasoning (a compound key
// would let a second proxy register itself as "the peer" of an existing
// relation).
chatRelationSchema.index({ relationId: 1 }, { unique: true });

export const ChatRelation = getOrCreateModel<
  ChatRelationDocument,
  ChatRelationModel
>('ChatRelation', chatRelationSchema);
