// The "送る" half of design.md's "通知を2段に分ける" split (Requirements 2.4,
// 2.5, 2.6, 10.4, 10.7). Task 8.1's `NotificationOutbox` writes a row and
// returns immediately so a page save is never held up by chat; this module is
// what eventually delivers that row, writes the proxy's per-target answer
// back into it, and -- when it cannot be delivered -- leaves a `given-up` row
// an operator can read.
//
// Four properties are the reason this file exists at all:
//
//  - **One row is taken by exactly one process.** There is no shared
//    distributed lock in this repository, and `crowi/index.ts` starts crons
//    unconditionally on every instance, so exclusion is done per row with a
//    conditional update (`findOneAndUpdate` flipping `state` to `claimed`).
//    Two instances ticking at the same second cannot send the same
//    notification twice.
//  - **A claim expires.** Without `claimedAt`, a row whose process died
//    mid-send would stay `claimed` forever -- owned by nobody, retried by
//    nobody, never reaching `given-up`. That is exactly the situation
//    Requirement 2.4 exists for, so a claim older than
//    `CLAIM_STALE_AFTER_MS` is re-claimable.
//  - **A retry is per target, not per row.** The proxy dedupes on
//    `(relationId, requestId, platform, channelId)`, so re-posting the whole
//    target list would be silently dropped for the targets that already
//    succeeded -- meaning a retry would never actually attempt the failed
//    ones. This module therefore sends only the targets with no `posted`
//    outcome recorded yet, and merges the new answer into the old one.
//  - **`requestId` stays; the signature does not.** The row's `requestId` is
//    minted once by `enqueue` and never changed (Requirement 10.4), which is
//    what makes the proxy's dedupe work. The signature, by contrast, must be
//    rebuilt on every attempt -- calling `notify` again does exactly that
//    (fresh nonce and `created`/`expires`), which is why this module calls
//    `notify` rather than holding on to anything from the previous attempt.

import type { NotificationResult } from '@growi/chat';
import { parseNotificationResult } from '@growi/chat';

import loggerFactory from '~/utils/logger';

import { notify } from '../proxy-client';
import type {
  ChatNotificationOutboxDocument,
  ChatNotificationOutboxTarget,
} from './models/chat-notification-outbox';
import { ChatNotificationOutbox } from './models/chat-notification-outbox';

const logger = loggerFactory(
  'growi:features:chat-integration:notification-dispatcher',
);

type NotificationOutcome = NotificationResult['outcomes'][number];

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
 * Wait before retrying a round whose only failure was `inventory-not-ready`.
 * The proxy simply has not fetched its channel list yet and says so; it
 * recovers on its own within about ten minutes, so waiting longer costs
 * nothing and hammering it earlier gains nothing.
 */
export const INVENTORY_NOT_READY_RETRY_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Upper bound on rows handled per `drain` call, so one tick cannot run
 * unboundedly long against a large backlog -- the next tick continues.
 */
const MAX_ROWS_PER_DRAIN = 50;

export interface DrainSummary {
  /** Rows all of whose targets are now `posted`. */
  readonly sent: number;
  /** Rows put back for another attempt later. */
  readonly failed: number;
  /** Rows that ran out of attempts and are now kept for an operator. */
  readonly givenUp: number;
}

export interface NotificationDispatcher {
  /**
   * Deliver every claimable row: unsent ones and ones whose backoff has
   * elapsed. Safe to run concurrently on several instances.
   */
  drain(now: Date): Promise<DrainSummary>;
}

export interface NotificationDispatcherDeps {
  /** Injection seam for tests; production uses `ProxyClient`'s own `notify`. */
  readonly notify?: typeof notify;
}

const targetKey = (target: { platform: string; channelId: string }): string =>
  `${target.platform}:${target.channelId}`;

/**
 * The outcomes already recorded on the row. Read through the shared parse
 * function rather than trusted as-is: the field is `Mixed`, so this is the
 * only place that can guarantee the shape before it is used to decide what
 * NOT to post again.
 */
const recordedOutcomes = (
  stored: unknown,
): ReadonlyArray<NotificationOutcome> => {
  if (stored == null) {
    return [];
  }
  const parsed = parseNotificationResult(stored);
  if ('error' in parsed) {
    logger.warn({ stored }, 'Discarding an unreadable outbox result');
    return [];
  }
  return parsed.outcomes;
};

/**
 * Merge a fresh answer over the recorded one, keyed by target. The proxy
 * answers for the targets it was given this round, so anything it does not
 * mention is a target that already succeeded earlier and must keep its
 * recorded outcome.
 */
const mergeOutcomes = (
  recorded: ReadonlyArray<NotificationOutcome>,
  fresh: ReadonlyArray<NotificationOutcome>,
): NotificationResult => {
  const byKey = new Map(recorded.map((o) => [targetKey(o), o]));
  for (const outcome of fresh) {
    byKey.set(targetKey(outcome), outcome);
  }
  return { outcomes: [...byKey.values()] };
};

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
  now: Date,
): Promise<ChatNotificationOutboxDocument | null> =>
  ChatNotificationOutbox.findOneAndUpdate(
    {
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

type RowOutcome = keyof DrainSummary;

const settleAsSent = async (
  row: ChatNotificationOutboxDocument,
  result: NotificationResult,
): Promise<void> => {
  await ChatNotificationOutbox.updateOne(
    { _id: row._id },
    { $set: { state: 'sent', result, claimedAt: null } },
  );
};

const settleAsRetryOrGivenUp = async (
  row: ChatNotificationOutboxDocument,
  result: NotificationResult,
  now: Date,
  countsTowardGivingUp: boolean,
): Promise<RowOutcome> => {
  if (!countsTowardGivingUp) {
    await ChatNotificationOutbox.updateOne(
      { _id: row._id },
      {
        $set: {
          state: 'pending',
          result,
          claimedAt: null,
          nextAttemptAt: new Date(
            now.getTime() + INVENTORY_NOT_READY_RETRY_INTERVAL_MS,
          ),
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
      { $set: { state: 'given-up', result, attempts, claimedAt: null } },
    );
    logger.warn(
      { relationId: row.relationId, requestId: row.requestId },
      'Gave up delivering a chat notification',
    );
    return 'givenUp';
  }

  await ChatNotificationOutbox.updateOne(
    { _id: row._id },
    {
      $set: {
        state: 'pending',
        result,
        attempts,
        claimedAt: null,
        nextAttemptAt: new Date(now.getTime() + backoffMsFor(attempts)),
      },
    },
  );
  return 'failed';
};

/**
 * Deliver one claimed row and settle it. Returns which counter of
 * `DrainSummary` this row belongs in.
 */
const deliverClaimedRow = async (
  row: ChatNotificationOutboxDocument,
  now: Date,
  send: typeof notify,
): Promise<RowOutcome> => {
  const recorded = recordedOutcomes(row.result);
  const postedKeys = new Set(
    recorded.filter((o) => o.status === 'posted').map(targetKey),
  );
  const pendingTargets: ChatNotificationOutboxTarget[] = row.targets
    .filter((target) => !postedKeys.has(targetKey(target)))
    .map((target) => ({
      platform: target.platform,
      channelId: target.channelId,
    }));

  if (pendingTargets.length === 0) {
    await settleAsSent(row, { outcomes: [...recorded] });
    return 'sent';
  }

  const answer = await send(row.relationId, {
    requestId: row.requestId,
    targets: pendingTargets,
    markdown: row.markdown,
    containsRestrictedPage: row.containsRestrictedPage,
  });

  if (!answer.ok) {
    // No per-target information exists, so every target still pending
    // counts as an ordinary failure of this round.
    logger.warn(
      {
        relationId: row.relationId,
        requestId: row.requestId,
        reason: answer.reason,
      },
      'A chat notification could not be delivered',
    );
    return settleAsRetryOrGivenUp(row, mergeOutcomes(recorded, []), now, true);
  }

  const merged = mergeOutcomes(recorded, answer.response.outcomes);
  const unposted = merged.outcomes.filter((o) => o.status !== 'posted');
  const stillMissing = pendingTargets.some(
    (target) =>
      !merged.outcomes.some(
        (o) => targetKey(o) === targetKey(target) && o.status === 'posted',
      ),
  );

  if (!stillMissing) {
    await settleAsSent(row, merged);
    return 'sent';
  }

  // A round whose only failures are `inventory-not-ready` must not push the
  // row toward `given-up`; any other failure reason does.
  const countsTowardGivingUp = unposted.some(
    (o) => o.status !== 'inventory-not-ready',
  );
  return settleAsRetryOrGivenUp(row, merged, now, countsTowardGivingUp);
};

export const createNotificationDispatcher = (
  deps: NotificationDispatcherDeps = {},
): NotificationDispatcher => {
  const send = deps.notify ?? notify;

  return {
    async drain(now) {
      const counts = { sent: 0, failed: 0, givenUp: 0 };

      for (let i = 0; i < MAX_ROWS_PER_DRAIN; i++) {
        const row = await claimOneRow(now);
        if (row == null) {
          break;
        }
        const outcome = await deliverClaimedRow(row, now, send);
        counts[outcome] += 1;
      }

      return counts;
    },
  };
};

export const notificationDispatcher: NotificationDispatcher =
  createNotificationDispatcher();
