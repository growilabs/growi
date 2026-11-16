// An `agent` request GROWI accepted and has not yet answered. Why the answer's
// destination is kept here and not sent to GROWI: design.md, Security Considerations.
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
  /**
   * Deletes the one request, when GROWI turned it down. Answers how many rows
   * went, so a request already gone is not an error.
   */
  delete(relationId: string, requestId: string): Promise<number>;
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

// Throws on an unknown value: reading it as `null` ("not started") would let
// the answer be delivered again.
const toDeliveryStatus = (
  row: PendingAgentRequestRow,
): AgentDeliveryStatus | null => {
  if (row.deliveryStatus == null) return null;
  const known = DELIVERY_STATUSES.find(
    (status) => status === row.deliveryStatus,
  );
  if (known == null) {
    throw new Error(
      `pending_agent_request ${row.relationId}/${row.requestId} has an unknown delivery_status: ${row.deliveryStatus}`,
    );
  }
  return known;
};

const toRecord = (row: PendingAgentRequestRow): PendingAgentRequestRecord => ({
  relationId: row.relationId,
  requestId: row.requestId,
  installationId: row.installationId,
  // The JSON column round-trips what `create` wrote.
  origin: row.origin as StoredAnswerOrigin,
  deliveryStatus: toDeliveryStatus(row),
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

  delete: async (relationId, requestId) => {
    const result = await db.pendingAgentRequest.deleteMany({
      where: { relationId, requestId },
    });
    return result.count;
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
