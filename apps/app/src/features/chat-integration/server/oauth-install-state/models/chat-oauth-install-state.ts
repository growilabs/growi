// A short-lived, one-time CSRF token GROWI issues before an admin opens a
// chat service's OAuth "install to workspace" flow (task 9.0; design.md
// "proxy 実装で見つかった未解決の論点" -- decision: this spec is the issuer).
//
// This is NOT `chat_pending_pairings` (Requirement 9's registration-code
// flow, GROWI <-> proxy trust) and NOT `chat_account_link_orders` (chat
// user <-> GROWI user trust). It protects a THIRD, earlier step: a chat
// service's own OAuth consent screen redirecting back to
// `chat-integration-proxy`'s `routes/install-routes.ts`, which today reads
// only `code` and has no CSRF check at all (Gen 1's `GET /oauth_redirect`
// had one; Gen 2 currently does not -- see design.md).
//
// Modeled after `chat_account_link_orders` (same one-time-token shape,
// `getOrCreateModel`, TTL index), but tracks `consumedAt` explicitly instead
// of an `isRevoked` flag: a CSRF state must be usable EXACTLY once, and
// `verifyOAuthInstallState`'s atomic claim (`../oauth-install-state-service`)
// needs a field it can flip from "unclaimed" to "claimed" in the same update
// that reads it -- `isRevoked` (chat_account_link_orders' shape) is for a
// human explicitly canceling an order, a different concept.
import type { PlatformName } from '@growi/chat';
import { addMinutes } from 'date-fns/addMinutes';
import type { Document, Model, Types } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

/**
 * Default lifetime of an OAuth install `state`. Shorter than
 * `ACCOUNT_LINK_ORDER_DEFAULT_MINUTES` (10) on purpose: a chat account link
 * is a one-time link a human may open later from a chat message, while this
 * token only needs to survive the admin's own browser round-trip through the
 * service's consent screen and back -- typically well under a minute, never
 * more than a few. 5 minutes gives headroom for a slow consent screen
 * without leaving a CSRF-usable token alive for long.
 */
export const OAUTH_INSTALL_STATE_DEFAULT_MINUTES = 5;

const defaultExpiresAt = (): Date =>
  addMinutes(new Date(), OAUTH_INSTALL_STATE_DEFAULT_MINUTES);

export interface IChatOAuthInstallState {
  /** Random, unpredictable CSRF token embedded in the install URL. */
  state: string;
  platform: PlatformName;
  /** The admin who started this "connect a new workspace" attempt. */
  createdBy: Types.ObjectId;
  /** Set the instant `verifyOAuthInstallState` claims this token; `null` while unclaimed. */
  consumedAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface ChatOAuthInstallStateDocument
  extends IChatOAuthInstallState,
    Document {}

export interface ChatOAuthInstallStateModel
  extends Model<ChatOAuthInstallStateDocument> {}

const chatOAuthInstallStateSchema = new Schema<
  ChatOAuthInstallStateDocument,
  ChatOAuthInstallStateModel
>(
  {
    state: { type: String, required: true },
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
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    consumedAt: { type: Date, required: false, default: null },
    createdAt: { type: Date, required: true, default: () => new Date() },
    expiresAt: { type: Date, required: true, default: defaultExpiresAt },
  },
  {
    collection: 'chat_oauth_install_states',
    timestamps: false,
  },
);

chatOAuthInstallStateSchema.index({ state: 1 }, { unique: true });
chatOAuthInstallStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ChatOAuthInstallState = getOrCreateModel<
  ChatOAuthInstallStateDocument,
  ChatOAuthInstallStateModel
>('ChatOAuthInstallState', chatOAuthInstallStateSchema);
