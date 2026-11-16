import type { ChannelRef, ChatAccountRef, PlatformName } from '@growi/chat';
import type { Document, Model, Types } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

import type { CommandAuditContext } from '../../command/command-endpoint';

export type ChatAgentRequestState = 'running' | 'done';

export interface IChatAgentRequest {
  relationId: string;
  requestId: string;
  /** The linked GROWI user; at most one `running` row exists per user. */
  userId: Types.ObjectId;
  state: ChatAgentRequestState;
  text: string;
  conversationKey: string;
  actor: ChatAccountRef;
  channel: ChannelRef;
  auditContext: CommandAuditContext;
  /** Rows are removed 24 hours after this instant by a TTL index. */
  startedAt: Date;
}

export interface ChatAgentRequestDocument extends IChatAgentRequest, Document {}

export interface ChatAgentRequestModel
  extends Model<ChatAgentRequestDocument> {}

const PLATFORMS: PlatformName[] = ['slack', 'discord', 'teams', 'mattermost'];

const actorSchema = new Schema(
  {
    platform: { type: String, enum: PLATFORMS, required: true },
    accountId: { type: String, required: true },
    displayName: { type: String, required: true },
  },
  { _id: false },
);

const channelSchema = new Schema(
  {
    platform: { type: String, enum: PLATFORMS, required: true },
    channelId: { type: String, required: true },
    channelName: { type: String, required: true },
    isPrivate: { type: Boolean, required: true },
    isDirectMessage: { type: Boolean },
  },
  { _id: false },
);

const auditContextSchema = new Schema(
  {
    ip: { type: String },
    endpoint: { type: String },
    requestArrivedAt: { type: Date, required: true },
  },
  { _id: false },
);

const chatAgentRequestSchema = new Schema<
  ChatAgentRequestDocument,
  ChatAgentRequestModel
>(
  {
    relationId: { type: String, required: true },
    requestId: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    state: {
      type: String,
      enum: ['running', 'done'] satisfies ChatAgentRequestState[],
      required: true,
      default: 'running',
    },
    text: { type: String, required: true },
    conversationKey: { type: String, required: true },
    actor: { type: actorSchema, required: true },
    channel: { type: channelSchema, required: true },
    auditContext: { type: auditContextSchema, required: true },
    startedAt: { type: Date, required: true, default: () => new Date() },
  },
  {
    collection: 'chat_agent_requests',
    timestamps: false,
    // Every index of this collection is created by the migration
    // 20261116140000-add-chat-agent-request-indexes, never by the schema.
    autoIndex: false,
  },
);

export const ChatAgentRequest = getOrCreateModel<
  ChatAgentRequestDocument,
  ChatAgentRequestModel
>('ChatAgentRequest', chatAgentRequestSchema);
