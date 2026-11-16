// How ONE `notification` outbox row is sent (Requirements 2.4, 10.4, 10.7).
// Claiming, backoff and giving up belong to `outbox/outbox-dispatcher.ts`.
//
// Two properties are the reason this file exists at all:
//
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

import type { NotificationRequest, NotificationResult } from '@growi/chat';
import { parseNativeChannelId, parseNotificationResult } from '@growi/chat';

import loggerFactory from '~/utils/logger';

import type { ChatOutboxRowDocument } from '../outbox/models/chat-outbox';
import type { Deliverer, DeliveryVerdict } from '../outbox/outbox-dispatcher';
import { notify } from '../proxy-client';

const logger = loggerFactory(
  'growi:features:chat-integration:notification-deliverer',
);

type NotificationOutcome = NotificationResult['outcomes'][number];

/**
 * Wait before retrying a round whose only failure was `inventory-not-ready`.
 * The proxy simply has not fetched its channel list yet and says so; it
 * recovers on its own within about ten minutes, so waiting longer costs
 * nothing and hammering it earlier gains nothing.
 */
export const INVENTORY_NOT_READY_RETRY_INTERVAL_MS = 10 * 60 * 1000;

export interface NotificationDelivererDeps {
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
 * A round whose only failures are `inventory-not-ready` must not push the
 * row toward `given-up`; any other failure reason does.
 */
const retryVerdict = (merged: NotificationResult): DeliveryVerdict => {
  const unposted = merged.outcomes.filter((o) => o.status !== 'posted');
  const countsTowardGivingUp = unposted.some(
    (o) => o.status !== 'inventory-not-ready',
  );
  return countsTowardGivingUp
    ? { outcome: 'retry', result: merged }
    : {
        outcome: 'retry',
        result: merged,
        retryAfterMs: INVENTORY_NOT_READY_RETRY_INTERVAL_MS,
      };
};

/** The row's targets that have not been posted yet and that the proxy can accept. */
const pendingTargetsOf = (
  row: ChatOutboxRowDocument,
  recorded: ReadonlyArray<NotificationOutcome>,
): ReadonlyArray<NotificationRequest['targets'][number]> => {
  const postedKeys = new Set(
    recorded.filter((o) => o.status === 'posted').map(targetKey),
  );
  return row.targets.flatMap((target) => {
    if (postedKeys.has(targetKey(target))) {
      return [];
    }
    const channelId = parseNativeChannelId(target.channelId);
    if (channelId === undefined) {
      // The proxy would refuse the whole request for one such id; a row
      // queued before ids were checked must not block its valid targets.
      logger.warn(
        { relationId: row.relationId, requestId: row.requestId },
        `Skipping an outbox target whose channel id is not a chat service's own id: ${target.channelId}`,
      );
      return [];
    }
    return [{ platform: target.platform, channelId }];
  });
};

export const createNotificationDeliverer = (
  deps: NotificationDelivererDeps = {},
): Deliverer => {
  const send = deps.notify ?? notify;

  return async (row) => {
    const recorded = recordedOutcomes(row.result);
    const pendingTargets = pendingTargetsOf(row, recorded);

    if (pendingTargets.length === 0) {
      return { outcome: 'sent', result: { outcomes: [...recorded] } };
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
      return { outcome: 'retry', result: mergeOutcomes(recorded, []) };
    }

    const merged = mergeOutcomes(recorded, answer.response.outcomes);
    const stillMissing = pendingTargets.some(
      (target) =>
        !merged.outcomes.some(
          (o) => targetKey(o) === targetKey(target) && o.status === 'posted',
        ),
    );

    return stillMissing
      ? retryVerdict(merged)
      : { outcome: 'sent', result: merged };
  };
};
