import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';

import loggerFactory from '~/utils/logger';

import { AnonymousSyncCounter } from '../models/anonymous-sync-counter';
import type { EsSyncDecisionValue } from '../models/es-sync-decision';
import { EsSyncDecision } from '../models/es-sync-decision';

const logger = loggerFactory('growi:service:decide-es-sync-for-event');

// Grace period before a 'pending' claim is treated as abandoned (the process that
// took it crashed, or stalled) and another process may take it over. Also the wait
// timeout below, so a waiter never outlives the point where it would just steal the
// claim itself.
const STALE_CLAIM_MS = 5000;
const WAIT_POLL_INTERVAL_MS = 50;

const isDuplicateKeyError = (err: unknown): boolean =>
  err instanceof Error &&
  'code' in err &&
  (err as { code: unknown }).code === 11000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// Poll for the claiming process's result. Falls back to 'dropped' if it never
// resolves within the same grace period a stale claim would be stolen after —
// MongoDB already has the full event, so failing toward "not synced to ES" costs
// nothing but a slower search, and never blocks the batch indefinitely.
const waitForDecision = async (
  activityId: string,
): Promise<EsSyncDecisionValue> => {
  const deadline = Date.now() + STALE_CLAIM_MS;
  while (Date.now() < deadline) {
    // biome-ignore lint/performance/noAwaitInLoops: intentional poll with a bounded deadline.
    const doc = await EsSyncDecision.findById(activityId).lean();
    if (doc != null && doc.decision !== 'pending') return doc.decision;
    await sleep(WAIT_POLL_INTERVAL_MS);
  }
  return 'dropped';
};

// Thrown inside the transaction below to abort it cleanly (no partial writes) when the
// claim turns out to already be lost — distinguished from a genuine DB error so the
// caller falls back to waitForDecision() instead of rethrowing.
class ClaimLostError extends Error {}

/**
 * Decide whether one anonymous-log event should sync to Elasticsearch, gated by a
 * per-(endpoint, windowStart) admission count. Safe to call redundantly from every
 * GROWI process for the same event (see auditlog-changestream.ts's STREAM_KEY
 * comment): exactly one caller across all of them ends up incrementing the counter
 * for a given event, via the EsSyncDecision._id uniqueness constraint — "first insert
 * wins" — everyone else reads that winner's result instead of deciding themselves.
 */
export const decideEsSyncForEvent = async (
  activityId: string,
  endpoint: string,
  windowStart: Date,
  threshold: number,
): Promise<EsSyncDecisionValue> => {
  // Cheap early-out: once a window is confidently past threshold, skip the per-event
  // claim dance entirely (no EsSyncDecision write, no counter $inc). Strictly greater
  // than threshold, not >=: the event that pushes the count to exactly threshold + 1
  // must still go through the full path below, since that is the one 'dropped' event
  // that logs the "threshold reached" warning (see after.count === threshold + 1).
  const current = await AnonymousSyncCounter.findOne({
    endpoint,
    windowStart,
  }).lean();
  if (current != null && current.count > threshold) {
    return 'dropped';
  }

  const now = new Date();
  // Fencing token for this call's claim. Every write this call makes while holding
  // the claim is conditioned on this token, so a call that stalls long enough for
  // another process to steal the claim (see STALE_CLAIM_MS) detects the loss instead
  // of acting as if it still owned it.
  const claimToken = randomUUID();

  let holdsClaim = false;
  try {
    await EsSyncDecision.create({
      _id: activityId,
      endpoint,
      windowStart,
      decision: 'pending',
      claimedAt: now,
      claimToken,
    });
    holdsClaim = true;
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
  }

  if (!holdsClaim) {
    // A claim already exists for this event. Take it over only if it looks
    // abandoned; otherwise its owner is still (or was recently) working on it.
    const stolen = await EsSyncDecision.findOneAndUpdate(
      {
        _id: activityId,
        decision: 'pending',
        claimedAt: { $lt: new Date(now.getTime() - STALE_CLAIM_MS) },
      },
      { $set: { claimedAt: now, claimToken } },
      { new: true },
    );
    holdsClaim = stolen != null;
  }

  if (!holdsClaim) {
    return waitForDecision(activityId);
  }

  // From here on, "reconfirm the claim, $inc the counter, and finalize the decision"
  // must be all-or-nothing: if this call stalls between separate, unguarded writes,
  // another process can steal the claim and complete its own full cycle in between,
  // and this call would otherwise resume and $inc a second time for the same event
  // (or overwrite the new holder's decision) without realizing it lost the claim.
  // A transaction makes the three writes atomic instead of trying to fence each one
  // individually.
  const session = await mongoose.startSession();
  let decision: EsSyncDecisionValue | undefined;
  // withTransaction may re-invoke its callback in full on a retryable driver error
  // (e.g. a WriteConflict from a concurrent $inc below), so a side effect like
  // logger.warn cannot live inside it without risking a double log. This flag is
  // reset on every callback invocation and only its value from the attempt that
  // actually commits survives to be read below.
  let thresholdJustReached = false;
  try {
    await session.withTransaction(async () => {
      thresholdJustReached = false;

      const reconfirmed = await EsSyncDecision.findOneAndUpdate(
        { _id: activityId, claimToken },
        { $set: { claimedAt: new Date() } },
        { session },
      );
      if (reconfirmed == null) {
        throw new ClaimLostError();
      }

      // The only call site that should ever $inc the counter; runs at most once per
      // distinct event (redundant processing from other GROWI processes either loses
      // the claim race above, or aborts this same transaction via ClaimLostError).
      const after = await AnonymousSyncCounter.findOneAndUpdate(
        { endpoint, windowStart },
        { $inc: { count: 1 }, $set: { updatedAt: new Date() } },
        { upsert: true, new: true, session },
      );
      decision = after.count <= threshold ? 'admitted' : 'dropped';

      // Recorded once per (endpoint, windowStart) — at the exact event that pushes the
      // count past threshold — not on every subsequent 'dropped' event in the same
      // window, so a sustained attack doesn't flood the log with one line per event.
      // The actual logger.warn call happens after the transaction commits (see below).
      if (after.count === threshold + 1) {
        thresholdJustReached = true;
      }

      await EsSyncDecision.updateOne(
        { _id: activityId, claimToken },
        { $set: { decision, claimedAt: new Date() } },
        { session },
      );
    });
  } catch (err) {
    if (err instanceof ClaimLostError) {
      return waitForDecision(activityId);
    }
    throw err;
  } finally {
    await session.endSession();
  }

  if (thresholdJustReached) {
    logger.warn(
      { endpoint, windowStart, threshold },
      'Anonymous log ES sync threshold reached; further anonymous logs for this endpoint in this window are dropped from ES (still recorded in MongoDB).',
    );
  }

  // decision is always set once withTransaction resolves without throwing.
  return decision as EsSyncDecisionValue;
};
