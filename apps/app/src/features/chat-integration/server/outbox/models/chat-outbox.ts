import type { AgentAnswer, PlatformName } from '@growi/chat';
import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

/**
 * Retention period for a `sent` outbox row, in seconds. `given-up` rows are
 * NOT covered by this TTL -- they stay until an operator looks at them
 * (design.md `chat_notification_outbox` row).
 */
export const NOTIFICATION_OUTBOX_SENT_TTL_SECONDS = 30 * 24 * 60 * 60;

export const OUTBOX_KINDS = ['notification', 'command-answer'] as const;

export type OutboxKind = (typeof OUTBOX_KINDS)[number];

export type ChatNotificationOutboxState =
  | 'pending'
  | 'claimed'
  | 'sent'
  | 'given-up';

/** One notification-fan-out target, mirrors `NotificationRequest.targets`. */
export interface ChatNotificationOutboxTarget {
  platform: PlatformName;
  channelId: string;
}

export interface IChatNotificationOutbox {
  /**
   * Which deliverer sends this row. `targets`, `markdown` and
   * `containsRestrictedPage` are written on `notification` rows only, and
   * `answer` on `command-answer` rows only.
   */
  kind: OutboxKind;
  /** On a `command-answer` row, the `requestId` of the `agent` request. */
  requestId: string;
  relationId: string;
  targets: ChatNotificationOutboxTarget[];
  markdown: string;
  /**
   * Informational proxy audit-trail signal (design.md
   * "通知を2段に分ける" -- `containsRestrictedPage` is proxy申し送りにすぎず、
   * dropping the body already happened in `markdown` by the time `enqueue`
   * is called). Persisted here so `NotificationDispatcher` (task 8.2) can
   * carry it into the wire-level `NotificationRequest` when it drains this
   * row -- it is NOT redundant with `markdown`, which never contains a
   * restricted page's body regardless of this flag's value.
   */
  containsRestrictedPage: boolean;
  state: ChatNotificationOutboxState;
  /**
   * Number of delivery attempts that count toward giving up. A round whose
   * only failures were `inventory-not-ready` does NOT increment this
   * (design.md "`inventory-not-ready` は諦めの回数に数えない" -- the proxy
   * merely has not fetched its channel list yet, which fixes itself in about
   * ten minutes; counting it would drop a just-paired relation's very first
   * notifications into `given-up` after a handful of minutes).
   */
  attempts: number;
  /** Set when `drain` claims this row for delivery; null while `pending`. */
  claimedAt: Date | null;
  /**
   * Earliest instant at which a `pending` row may be claimed again -- the
   * "間隔を空けてやり直す" half of design.md's retry rule. Set to the row's
   * creation time on `enqueue` (so a fresh row is claimable immediately) and
   * pushed forward by the backoff after every failed round.
   *
   * A separate field rather than reusing `claimedAt`: `claimedAt` answers
   * "when did somebody take this row" (what the 5-minute stale-claim
   * recovery reads), and overloading it would make a backing-off row look
   * like a crashed one.
   */
  nextAttemptAt: Date;
  /**
   * The proxy's `NotificationResult` written back after a delivery attempt.
   * Opaque at the schema level -- shape is owned by `@growi/chat`'s
   * `NotificationResult` contract, not duplicated here.
   */
  result: unknown;
  answer: AgentAnswer | null;
  createdAt: Date;
}

export interface ChatNotificationOutboxDocument
  extends IChatNotificationOutbox,
    Document {}

export interface ChatNotificationOutboxModel
  extends Model<ChatNotificationOutboxDocument> {}

const chatNotificationOutboxTargetSchema =
  new Schema<ChatNotificationOutboxTarget>(
    {
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
    },
    { _id: false },
  );

function isNotificationRow(this: ChatNotificationOutboxDocument): boolean {
  return this.kind === 'notification';
}

const chatNotificationOutboxSchema = new Schema<
  ChatNotificationOutboxDocument,
  ChatNotificationOutboxModel
>(
  {
    kind: {
      type: String,
      enum: OUTBOX_KINDS,
      required: true,
      default: 'notification',
    },
    requestId: { type: String, required: true },
    relationId: { type: String, required: true },
    targets: {
      type: [chatNotificationOutboxTargetSchema],
      required: isNotificationRow,
      default: [],
    },
    markdown: { type: String, required: isNotificationRow },
    containsRestrictedPage: { type: Boolean, required: isNotificationRow },
    state: {
      type: String,
      enum: [
        'pending',
        'claimed',
        'sent',
        'given-up',
      ] satisfies ChatNotificationOutboxState[],
      required: true,
      default: 'pending',
    },
    attempts: { type: Number, required: true, default: 0 },
    claimedAt: { type: Date, default: null },
    nextAttemptAt: { type: Date, required: true, default: () => new Date() },
    result: { type: Schema.Types.Mixed, default: null },
    answer: { type: Schema.Types.Mixed, default: null },
    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  {
    collection: 'chat_notification_outbox',
    timestamps: false,
  },
);

// `drain` claims rows to process by (state, claimedAt) -- e.g. "pending
// rows, oldest claim first". This is a different access pattern than the
// write-back-by-request lookup below, so it is a separate index rather than
// a single combined one (design.md is explicit that these are two indexes).
chatNotificationOutboxSchema.index({ state: 1, claimedAt: 1 });

// The other half of the same claim: `drain`'s filter is an `$or` of "a
// `pending` row whose backoff has elapsed" and "a `claimed` row whose claim
// went stale", and MongoDB picks an index per `$or` branch. The index above
// serves the stale-claim branch; this one serves the pending branch, which is
// the one every ordinary tick uses.
chatNotificationOutboxSchema.index({ state: 1, nextAttemptAt: 1 });

// The proxy's result write-back looks up the row by (relationId, requestId).
chatNotificationOutboxSchema.index({ relationId: 1, requestId: 1 });

// The unique (relationId, requestId) index on `command-answer` rows is created
// by a migration (20261116120000-add-kind-to-chat-notification-outbox), not here.

// Only `sent` rows are subject to the 30-day TTL; `given-up` rows must
// survive until an operator inspects them, so the TTL index is scoped with
// partialFilterExpression rather than applied to every row's createdAt.
chatNotificationOutboxSchema.index(
  { createdAt: 1 },
  {
    expireAfterSeconds: NOTIFICATION_OUTBOX_SENT_TTL_SECONDS,
    partialFilterExpression: { state: 'sent' },
  },
);

export const ChatNotificationOutbox = getOrCreateModel<
  ChatNotificationOutboxDocument,
  ChatNotificationOutboxModel
>('ChatNotificationOutbox', chatNotificationOutboxSchema);
