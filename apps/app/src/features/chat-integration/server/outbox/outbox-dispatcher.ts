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
//
// Drains start from two places -- right after a row is written
// (`requestDrain`, Requirement 2.10) and from the cron -- and both go
// through `requestDrain`, so a process never runs two drains at once.

import loggerFactory from '~/utils/logger';

import { createCoalescingRunner } from './coalescing-runner';
import type { ChatOutboxRowDocument, OutboxKind } from './models/chat-outbox';
import { ChatOutboxRow, OUTBOX_KINDS } from './models/chat-outbox';

const logger = loggerFactory(
  'growi:features:chat-integration:outbox-dispatcher',
);

/**
 * How long a claim is honored before another instance may take the row back.
 * With the cron every 5 minutes, a stalled send is taken back at most
 * 4 + 5 = 9 minutes after its claim (Requirement 2.11).
 */
export const CLAIM_STALE_AFTER_MS = 4 * 60 * 1000;

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
 * Upper bound on rows handled per `drain` call. `requestDrain` drains again
 * after a full batch, so a burst of writes is not left for the cron.
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
  row: ChatOutboxRowDocument,
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
   * elapsed. Safe to run concurrently on several instances. `now` is the
   * time the drain starts; each row is claimed at that time plus however
   * long the drain has been running.
   */
  drain(now: Date): Promise<DrainSummary>;
  /**
   * Start a drain at the current time unless one is running in this process;
   * if one is, run one more after it. Resolves once a drain that began after
   * this call has finished. Never rejects: a failed drain is logged.
   */
  requestDrain(): Promise<void>;
}

export interface OutboxDispatcherDeps {
  readonly deliverers: DelivererTable;
  /** Test seam; production uses `() => new Date()`. */
  readonly clock?: () => Date;
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

/** Which rows one run of claims may take. */
interface ClaimScope {
  /** A `pending` row is due when its next attempt is at or before this. */
  readonly dueBy: Date;
  /** Rows this run has already tried; never taken twice in one run. */
  readonly tried: ReadonlyArray<unknown>;
}

/**
 * Take one row for this process, or `null` when there is nothing to do. The
 * `$or` is the whole exclusion mechanism: a row is claimable when it is
 * `pending` and its backoff has elapsed, or when it is `claimed` but the
 * claim went stale (the claiming process died).
 */
const claimOneRow = async (
  kinds: ReadonlyArray<OutboxKind>,
  scope: ClaimScope,
  now: Date,
): Promise<ChatOutboxRowDocument | null> =>
  ChatOutboxRow.findOneAndUpdate(
    {
      kind: { $in: kinds },
      _id: { $nin: scope.tried },
      $or: [
        { state: 'pending', nextAttemptAt: { $lte: scope.dueBy } },
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
  row: ChatOutboxRowDocument,
  verdict: Extract<DeliveryVerdict, { outcome: 'retry' }>,
  now: Date,
): Promise<RowOutcome> => {
  if (verdict.retryAfterMs != null) {
    await ChatOutboxRow.updateOne(
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
    await ChatOutboxRow.updateOne(
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

  await ChatOutboxRow.updateOne(
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
  row: ChatOutboxRowDocument,
  verdict: DeliveryVerdict,
  now: Date,
): Promise<RowOutcome> => {
  if (verdict.outcome === 'retry') {
    return settleAsRetry(row, verdict, now);
  }
  await ChatOutboxRow.updateOne(
    { _id: row._id },
    { $set: { state: 'sent', ...resultOf(verdict), claimedAt: null } },
  );
  return 'sent';
};

export const createOutboxDispatcher = (
  deps: OutboxDispatcherDeps,
): OutboxDispatcher => {
  const kinds = OUTBOX_KINDS.filter((kind) => deps.deliverers[kind] != null);
  const clock = deps.clock ?? (() => new Date());

  /**
   * One batch of at most `MAX_ROWS_PER_DRAIN` rows. Each row is claimed at
   * `currentTime()`, not at the batch's start: otherwise the later rows of
   * a long batch look stale while they are being sent.
   */
  const drainBatch = async (
    scope: ClaimScope,
    currentTime: () => Date,
  ): Promise<{ summary: DrainSummary; tried: ReadonlyArray<unknown> }> => {
    const counts = { sent: 0, failed: 0, givenUp: 0 };
    let tried = scope.tried;

    for (let i = 0; i < MAX_ROWS_PER_DRAIN; i++) {
      const claimedAt = currentTime();
      const row = await claimOneRow(kinds, { ...scope, tried }, claimedAt);
      if (row == null) {
        break;
      }
      tried = [...tried, row._id];
      const deliver = deps.deliverers[row.kind];
      if (deliver == null) {
        // Unreachable: only kinds with a deliverer are claimed.
        throw new Error(`No deliverer for outbox kind: ${row.kind}`);
      }
      const verdict = await deliver(row, claimedAt);
      const outcome = await settle(row, verdict, claimedAt);
      counts[outcome] += 1;
    }

    return { summary: counts, tried };
  };

  const drain = async (now: Date): Promise<DrainSummary> => {
    const startedAt = clock().getTime();
    const { summary } = await drainBatch({ dueBy: now, tried: [] }, () => {
      return new Date(now.getTime() + clock().getTime() - startedAt);
    });
    return summary;
  };

  // Batch after batch, but only over the rows due when the run began and
  // each row at most once, so the run ends whatever the deliverers answer.
  // A row written during the run is sent by the run its writer requests.
  const drainBacklog = async (): Promise<void> => {
    let scope: ClaimScope = { dueBy: clock(), tried: [] };
    let handled: number;
    do {
      // biome-ignore lint/performance/noAwaitInLoops: batches run one after another by design
      const { summary, tried } = await drainBatch(scope, clock);
      scope = { ...scope, tried };
      handled = summary.sent + summary.failed + summary.givenUp;
    } while (handled >= MAX_ROWS_PER_DRAIN);
  };

  const requestDrain = createCoalescingRunner(drainBacklog, (err) => {
    // Name and message only: an HTTP error object carries signed headers.
    const { name, message } =
      err instanceof Error ? err : { name: 'Error', message: String(err) };
    logger.error({ name, message }, 'Failed to drain the chat outbox');
  });

  return { drain, requestDrain };
};
