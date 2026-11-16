// The "送る" half of the outbox (Requirements 2.4, 2.5, 2.6, 10.4, 10.7,
// 15.11): claims a row, hands it to the deliverer registered for its kind,
// and settles it as sent, as a retry with backoff, or as given up. How ONE row
// of a kind is sent is the deliverer's job; this module never looks inside a
// row's kind-specific fields.
//
// Three properties are the reason this file exists at all:
//
//  - **One row is taken by exactly one process.** There is no shared
//    distributed lock in this repository, and `crowi/index.ts` starts crons
//    unconditionally on every instance, so exclusion is done per row with a
//    conditional update (`findOneAndUpdate` flipping `state` to `claimed`).
//    Two instances ticking at the same second cannot send the same row twice.
//  - **A claim expires.** Without `claimedAt`, a row whose process died
//    mid-send would stay `claimed` forever -- owned by nobody, retried by
//    nobody, never reaching `given-up`. That is exactly the situation
//    Requirement 2.4 exists for, so a claim older than
//    `CLAIM_STALE_AFTER_MS` is re-claimable.
//  - **Only kinds with a deliverer are claimed.** A row of a kind this
//    process cannot send stays `pending` for a process that can.

import loggerFactory from '~/utils/logger';

import type {
  ChatNotificationOutboxDocument,
  OutboxKind,
} from './models/chat-outbox';
import { ChatNotificationOutbox, OUTBOX_KINDS } from './models/chat-outbox';

const logger = loggerFactory(
  'growi:features:chat-integration:outbox-dispatcher',
);

/**
 * How long a claim is honored before another instance may take the row back.
 * design.md: "奪う条件は「`pending` の行」または「`claimed` だが `claimedAt` が
 * 既定 5 分より古い行」".
 */
export const CLAIM_STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * Backoff shape, following `growi-vault`'s `resilience/retry-policy.ts`
 * (design.md "やり直しの間隔は `growi-vault` の retry-policy に倣う"). That module
 * is explicitly internal to its own barrel, so the formula is reproduced here
 * rather than imported across feature boundaries.
 */
export const NOTIFICATION_RETRY_CONFIG = {
  /** Ordinary failures beyond this many attempts become `given-up`. */
  maxAttempts: 5,
  baseBackoffMs: 60 * 1000,
  maxBackoffMs: 30 * 60 * 1000,
} as const;

/**
 * Upper bound on rows handled per `drain` call, so one tick cannot run
 * unboundedly long against a large backlog -- the next tick continues.
 */
const MAX_ROWS_PER_DRAIN = 50;

/**
 * What a deliverer reports for one row. `result`, when present, is written
 * onto the row as the record an operator reads.
 *
 * A `retry` that names its own `retryAfterMs` means the far side asked to be
 * tried again later rather than failing: the row waits exactly that long and
 * the round does not count toward giving up. A `retry` without it is an
 * ordinary failure: it counts, and the row waits the backoff.
 */
export type DeliveryVerdict =
  | { readonly outcome: 'sent'; readonly result?: unknown }
  | {
      readonly outcome: 'retry';
      readonly result?: unknown;
      readonly retryAfterMs?: number;
    };

export type Deliverer = (
  row: ChatNotificationOutboxDocument,
  now: Date,
) => Promise<DeliveryVerdict>;

/** How to send one row, per kind. A kind without an entry is never claimed. */
export type DelivererTable = { readonly [K in OutboxKind]?: Deliverer };

export interface DrainSummary {
  /** Rows the deliverer reported as sent. */
  readonly sent: number;
  /** Rows put back for another attempt later. */
  readonly failed: number;
  /** Rows that ran out of attempts and are now kept for an operator. */
  readonly givenUp: number;
}

export interface OutboxDispatcher {
  /**
   * Deliver every claimable row: unsent ones and ones whose backoff has
   * elapsed. Safe to run concurrently on several instances.
   */
  drain(now: Date): Promise<DrainSummary>;
}

export interface OutboxDispatcherDeps {
  readonly deliverers: DelivererTable;
}

type RowOutcome = keyof DrainSummary;

/**
 * Formula from `growi-vault`'s `decideRetry`: exponential from the base,
 * capped, plus up to 10% of the base as jitter so instances that failed on
 * the same tick do not all come back on the same tick.
 */
const backoffMsFor = (attempts: number): number => {
  const base = Math.min(
    NOTIFICATION_RETRY_CONFIG.maxBackoffMs,
    NOTIFICATION_RETRY_CONFIG.baseBackoffMs * 2 ** (attempts - 1),
  );
  const jitter = Math.random() * NOTIFICATION_RETRY_CONFIG.baseBackoffMs * 0.1;
  return base + jitter;
};

/**
 * Take one row for this process, or `null` when there is nothing to do. The
 * `$or` is the whole exclusion mechanism: a row is claimable when it is
 * `pending` and its backoff has elapsed, or when it is `claimed` but the
 * claim went stale (the claiming process died).
 */
const claimOneRow = async (
  kinds: ReadonlyArray<OutboxKind>,
  now: Date,
): Promise<ChatNotificationOutboxDocument | null> =>
  ChatNotificationOutbox.findOneAndUpdate(
    {
      kind: { $in: kinds },
      $or: [
        { state: 'pending', nextAttemptAt: { $lte: now } },
        {
          state: 'claimed',
          claimedAt: { $lt: new Date(now.getTime() - CLAIM_STALE_AFTER_MS) },
        },
      ],
    },
    { $set: { state: 'claimed', claimedAt: now } },
    { new: true, sort: { nextAttemptAt: 1 } },
  );

const resultOf = (verdict: DeliveryVerdict): { result?: unknown } =>
  'result' in verdict ? { result: verdict.result } : {};

const settleAsRetry = async (
  row: ChatNotificationOutboxDocument,
  verdict: Extract<DeliveryVerdict, { outcome: 'retry' }>,
  now: Date,
): Promise<RowOutcome> => {
  if (verdict.retryAfterMs != null) {
    await ChatNotificationOutbox.updateOne(
      { _id: row._id },
      {
        $set: {
          state: 'pending',
          ...resultOf(verdict),
          claimedAt: null,
          nextAttemptAt: new Date(now.getTime() + verdict.retryAfterMs),
        },
      },
    );
    return 'failed';
  }

  const attempts = row.attempts + 1;
  if (attempts >= NOTIFICATION_RETRY_CONFIG.maxAttempts) {
    // Deliberately left in place with no TTL: `given-up` is the record
    // Requirement 2.4 asks for, and only an operator retires it.
    await ChatNotificationOutbox.updateOne(
      { _id: row._id },
      {
        $set: {
          state: 'given-up',
          ...resultOf(verdict),
          attempts,
          claimedAt: null,
        },
      },
    );
    logger.warn(
      { kind: row.kind, relationId: row.relationId, requestId: row.requestId },
      'Gave up delivering a chat outbox row',
    );
    return 'givenUp';
  }

  await ChatNotificationOutbox.updateOne(
    { _id: row._id },
    {
      $set: {
        state: 'pending',
        ...resultOf(verdict),
        attempts,
        claimedAt: null,
        nextAttemptAt: new Date(now.getTime() + backoffMsFor(attempts)),
      },
    },
  );
  return 'failed';
};

const settle = async (
  row: ChatNotificationOutboxDocument,
  verdict: DeliveryVerdict,
  now: Date,
): Promise<RowOutcome> => {
  if (verdict.outcome === 'retry') {
    return settleAsRetry(row, verdict, now);
  }
  await ChatNotificationOutbox.updateOne(
    { _id: row._id },
    { $set: { state: 'sent', ...resultOf(verdict), claimedAt: null } },
  );
  return 'sent';
};

export const createOutboxDispatcher = (
  deps: OutboxDispatcherDeps,
): OutboxDispatcher => {
  const kinds = OUTBOX_KINDS.filter((kind) => deps.deliverers[kind] != null);

  return {
    async drain(now) {
      const counts = { sent: 0, failed: 0, givenUp: 0 };

      for (let i = 0; i < MAX_ROWS_PER_DRAIN; i++) {
        const row = await claimOneRow(kinds, now);
        if (row == null) {
          break;
        }
        const deliver = deps.deliverers[row.kind];
        if (deliver == null) {
          // Unreachable: only kinds with a deliverer are claimed.
          throw new Error(`No deliverer for outbox kind: ${row.kind}`);
        }
        const outcome = await settle(row, await deliver(row, now), now);
        counts[outcome] += 1;
      }

      return counts;
    },
  };
};
