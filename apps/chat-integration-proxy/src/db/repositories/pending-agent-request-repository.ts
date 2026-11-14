// An `agent` request GROWI accepted and has not yet answered (design.md's
// `pending_agent_request` table). The answer arrives later, from GROWI, naming
// only `(relationId, requestId)`; this row is what lets the proxy find the
// place to post it without GROWI ever being told where the question was asked.
//
// This file is storage only: which delivery state follows which, and when a
// stale 'delivering' mark may be taken over, belong to the answer flow.
import type { ChatAccountRef } from '@growi/chat';

import type { Prisma } from '../../generated/prisma/client.js';
import type { SdkChannelRef } from '../../types/index.js';
import type { DbClient } from '../prisma-client.js';

export interface StoredAnswerOrigin {
  readonly channel: SdkChannelRef;
  readonly actor: ChatAccountRef;
  readonly sourceMessageId: string | null;
  readonly threadRootId: string | null;
  readonly replyThreadRootId: string | null;
  /** `'direct'` is a DM with the bot, the Slack AI app view included. */
  readonly place: 'channel' | 'direct';
  readonly requestSummary: string;
}

export type AgentDeliveryStatus = 'delivering' | 'delivered' | 'undeliverable';

export interface PendingAgentRequestRecord {
  readonly relationId: string;
  readonly requestId: string;
  readonly installationId: string;
  readonly origin: StoredAnswerOrigin;
  /** `null` until a delivery has started. */
  readonly deliveryStatus: AgentDeliveryStatus | null;
  /** When `deliveryStatus` became `'delivering'`. */
  readonly deliveryClaimedAt: Date | null;
  readonly expiresAt: Date;
}

export type NewPendingAgentRequest = Pick<
  PendingAgentRequestRecord,
  'relationId' | 'requestId' | 'installationId' | 'origin' | 'expiresAt'
>;

export interface PendingAgentRequestRepository {
  create(request: NewPendingAgentRequest): Promise<PendingAgentRequestRecord>;
  find(
    relationId: string,
    requestId: string,
  ): Promise<PendingAgentRequestRecord | null>;
  /** Deletes every row past its `expiresAt`; scheduling is `runtime/sweeper.ts`. */
  deleteExpired(now: Date): Promise<number>;
  /** Part of the ordered removal of one relation (`db/relation-cascade.ts`). */
  deleteByRelation(relationId: string): Promise<number>;
}

interface PendingAgentRequestRow {
  readonly relationId: string;
  readonly requestId: string;
  readonly installationId: string;
  readonly origin: unknown;
  readonly deliveryStatus: string | null;
  readonly deliveryClaimedAt: Date | null;
  readonly expiresAt: Date;
}

const DELIVERY_STATUSES: ReadonlyArray<AgentDeliveryStatus> = [
  'delivering',
  'delivered',
  'undeliverable',
];

const toRecord = (row: PendingAgentRequestRow): PendingAgentRequestRecord => ({
  relationId: row.relationId,
  requestId: row.requestId,
  installationId: row.installationId,
  // The JSON column round-trips what `create` wrote.
  origin: row.origin as StoredAnswerOrigin,
  deliveryStatus:
    DELIVERY_STATUSES.find((status) => status === row.deliveryStatus) ?? null,
  deliveryClaimedAt: row.deliveryClaimedAt,
  expiresAt: row.expiresAt,
});

export const createPendingAgentRequestRepository = (
  db: DbClient,
): PendingAgentRequestRepository => ({
  create: async (request) =>
    toRecord(
      await db.pendingAgentRequest.create({
        data: {
          ...request,
          origin: request.origin as unknown as Prisma.InputJsonValue,
        },
      }),
    ),

  find: async (relationId, requestId) => {
    const row = await db.pendingAgentRequest.findUnique({
      where: { relationId_requestId: { relationId, requestId } },
    });
    return row == null ? null : toRecord(row);
  },

  deleteExpired: async (now) => {
    const result = await db.pendingAgentRequest.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    return result.count;
  },

  deleteByRelation: async (relationId) => {
    const result = await db.pendingAgentRequest.deleteMany({
      where: { relationId },
    });
    return result.count;
  },
});
