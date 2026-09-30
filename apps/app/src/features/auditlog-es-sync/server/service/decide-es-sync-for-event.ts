import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';

import loggerFactory from '~/utils/logger';

import { AnonymousSyncCounter } from '../models/anonymous-sync-counter';
import type { EsSyncDecisionValue } from '../models/es-sync-decision';
import { EsSyncDecision } from '../models/es-sync-decision';
import { ANCHOR_REFRESH_INTERVAL_SECONDS } from '../models/window-ttl';

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

const anchorRefreshCutoff = (now: Date): Date =>
  new Date(now.getTime() - ANCHOR_REFRESH_INTERVAL_SECONDS * 1000);

// Refreshes the TTL anchor when stale, so a batch retried over and over keeps its
// decisions alive (see window-ttl.ts for the retry gap this tolerates). The window's
// counter is refreshed too: a retried under-threshold window never $incs, so without
// this its counter would expire while its decisions survive, and the window would
// start admitting from 0 again. Its staleness is checked on its own anchor, not the
// decision's, or it could go up to one refresh interval longer untouched.
const findSettledDecision = async (
  activityId: string,
): Promise<EsSyncDecisionValue | undefined> => {
  const doc = await EsSyncDecision.findById(activityId).lean();
  if (doc == null || doc.decision === 'pending') return undefined;

  const now = new Date();
  const cutoff = anchorRefreshCutoff(now);
  await Promise.all([
    doc.claimedAt < cutoff &&
      EsSyncDecision.updateOne(
        { _id: activityId, claimedAt: { $lt: cutoff } },
        { $set: { claimedAt: now } },
      ),
    AnonymousSyncCounter.updateOne(
      {
        endpoint: doc.endpoint,
        windowStart: doc.windowStart,
        updatedAt: { $lt: cutoff },
      },
      { $set: { updatedAt: now } },
    ),
  ]);
  return doc.decision;
};

// Poll for the claiming process's result. Returns undefined if it never resolves
// within the same grace period a stale claim would be stolen after, so the caller
// can take the now-stale claim over instead of blocking the batch indefinitely.
const waitForDecision = async (
  activityId: string,
): Promise<EsSyncDecisionValue | undefined> => {
  const deadline = Date.now() + STALE_CLAIM_MS;
  while (Date.now() < deadline) {
    // biome-ignore lint/performance/noAwaitInLoops: intentional poll with a bounded deadline.
    const decision = await findSettledDecision(activityId);
    if (decision != null) return decision;
    await sleep(WAIT_POLL_INTERVAL_MS);
  }
  return undefined;
};

// Thrown inside the transaction below to abort it cleanly (no partial writes) when the
// claim turns out to already be lost — distinguished from a genuine DB error so the
// caller falls back to waitForDecision() instead of rethrowing.
class ClaimLostError extends Error {}

// Cheap early-out: once a window is confidently past threshold, skip the per-event
// claim dance entirely (no EsSyncDecision write, no counter $inc). Strictly greater
// than threshold, not >=: the event that pushes the count to exactly threshold + 1
// must still go through the full path below, since that is the one 'dropped' event
// that logs the "threshold reached" warning (see commitAdmissionDecision).
// Refreshes the counter's TTL anchor when stale even though it skips the $inc, or the
// counter would expire mid-window under a sustained attack and restart admitting from 0.
const isWindowConfidentlyOverThreshold = async (
  endpoint: string,
  windowStart: Date,
  threshold: number,
): Promise<boolean> => {
  const current = await AnonymousSyncCounter.findOne({
    endpoint,
    windowStart,
  }).lean();
  if (current == null || current.count <= threshold) return false;

  const now = new Date();
  const cutoff = anchorRefreshCutoff(now);
  if (current.updatedAt < cutoff) {
    await AnonymousSyncCounter.updateOne(
      { _id: current._id, updatedAt: { $lt: cutoff } },
      { $set: { updatedAt: now } },
    );
  }
  return true;
};

// Groups one call's identifying parameters so acquireClaim/commitAdmissionDecision/
// runClaimedTransaction stay under the max-params lint threshold.
interface AdmissionClaim {
  activityId: string;
  endpoint: string;
  windowStart: Date;
  threshold: number;
  claimToken: string;
}

// Create a fresh claim, or take over one that looks abandoned. Returns whether this
// call now holds the claim; false means another process is actively (or recently)
// working it, and the caller should wait for its result instead.
const acquireClaim = async (
  claim: AdmissionClaim,
  now: Date,
): Promise<boolean> => {
  const { activityId, endpoint, windowStart, claimToken } = claim;
  try {
    await EsSyncDecision.create({
      _id: activityId,
      endpoint,
      windowStart,
      decision: 'pending',
      claimedAt: now,
      claimToken,
    });
    return true;
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
  }

  const stolen = await EsSyncDecision.findOneAndUpdate(
    {
      _id: activityId,
      decision: 'pending',
      claimedAt: { $lt: new Date(now.getTime() - STALE_CLAIM_MS) },
    },
    { $set: { claimedAt: now, claimToken } },
    { new: true },
  );
  return stolen != null;
};

interface AdmissionOutcome {
  decision: EsSyncDecisionValue;
  thresholdJustReached: boolean;
}

// Reconfirm the claim, $inc the counter, and finalize the decision. Runs inside the
// caller's transaction, so all three writes commit or roll back together — otherwise
// a call that stalls between separate, unguarded writes could resume after another
// process stole the claim and completed its own cycle, and would $inc a second time
// for the same event (or overwrite the new holder's decision) without realizing it
// lost the claim.
const commitAdmissionDecision = async (
  session: mongoose.ClientSession,
  claim: AdmissionClaim,
): Promise<AdmissionOutcome> => {
  const { activityId, endpoint, windowStart, threshold, claimToken } = claim;

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
  const decision: EsSyncDecisionValue =
    after.count <= threshold ? 'admitted' : 'dropped';

  await EsSyncDecision.updateOne(
    { _id: activityId, claimToken },
    { $set: { decision, claimedAt: new Date() } },
    { session },
  );

  // Recorded once per (endpoint, windowStart) — at the exact event that pushes the
  // count past threshold — not on every subsequent 'dropped' event in the same
  // window, so a sustained attack doesn't flood the log with one line per event.
  return { decision, thresholdJustReached: after.count === threshold + 1 };
};

// A genuine (non-claim-loss) failure inside the transaction never commits, so
// commitAdmissionDecision's reconfirm/$inc/finalize never took effect — but the claim
// row from acquireClaim() was written outside this transaction and survives the
// rollback. Left alone it would sit as an orphaned 'pending' row until STALE_CLAIM_MS,
// so an immediate retry can neither steal it nor create a fresh one, and instead times
// out via waitForDecision() and wrongly returns 'dropped'. Release it so a retry can
// claim fresh instead.
const releaseOrphanedClaim = async (
  activityId: string,
  claimToken: string,
): Promise<void> => {
  try {
    await EsSyncDecision.deleteOne({
      _id: activityId,
      claimToken,
      decision: 'pending',
    });
  } catch (cleanupErr) {
    logger.error(
      { err: cleanupErr, activityId },
      'Failed to release orphaned pending EsSyncDecision claim after a transaction error.',
    );
  }
};

// Runs commitAdmissionDecision inside a transaction. withTransaction may re-invoke its
// callback in full on a retryable driver error (e.g. a WriteConflict from a concurrent
// $inc), so `outcome` is reassigned fresh on every invocation and only the value from
// the attempt that actually commits is read after the call returns.
const runClaimedTransaction = async (
  claim: AdmissionClaim,
): Promise<AdmissionOutcome | 'claim-lost'> => {
  const session = await mongoose.startSession();
  let outcome: AdmissionOutcome | undefined;
  try {
    await session.withTransaction(async () => {
      outcome = await commitAdmissionDecision(session, claim);
    });
  } catch (err) {
    if (err instanceof ClaimLostError) {
      return 'claim-lost';
    }
    await releaseOrphanedClaim(claim.activityId, claim.claimToken);
    throw err;
  } finally {
    await session.endSession();
  }

  // outcome is always set once withTransaction resolves without throwing.
  return outcome as AdmissionOutcome;
};

// Claim the event and decide it. Returns undefined when another process holds (or
// just took) the claim, so the caller should wait for that process's result instead.
const tryDecideAsClaimant = async (
  target: Omit<AdmissionClaim, 'claimToken'>,
): Promise<EsSyncDecisionValue | undefined> => {
  // Fencing token for this attempt's claim. Every write made while holding the claim
  // is conditioned on this token, so an attempt that stalls long enough for another
  // process to steal the claim (see STALE_CLAIM_MS) detects the loss instead of
  // acting as if it still owned it.
  const claim: AdmissionClaim = { ...target, claimToken: randomUUID() };

  if (!(await acquireClaim(claim, new Date()))) return undefined;

  const outcome = await runClaimedTransaction(claim);
  if (outcome === 'claim-lost') return undefined;

  const { endpoint, windowStart, threshold } = target;
  if (outcome.thresholdJustReached) {
    logger.warn(
      { endpoint, windowStart, threshold },
      'Anonymous log ES sync threshold reached; further anonymous logs for this endpoint in this window are dropped from ES (still recorded in MongoDB).',
    );
  }

  return outcome.decision;
};

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
  if (
    await isWindowConfidentlyOverThreshold(endpoint, windowStart, threshold)
  ) {
    // An event re-processed after its window filled up (a retried batch, a reindex
    // shortly after live traffic) keeps the decision it already got.
    return (await findSettledDecision(activityId)) ?? 'dropped';
  }

  const target = { activityId, endpoint, windowStart, threshold };

  const decided = await tryDecideAsClaimant(target);
  if (decided != null) return decided;

  const waited = await waitForDecision(activityId);
  if (waited != null) return waited;

  // Still unresolved after STALE_CLAIM_MS, so the claim is stale by now: take it
  // over once rather than dropping an event whose claimant died. Dropping it here
  // would let the shared resume token move past it with no unsynced flag set.
  const retried = await tryDecideAsClaimant(target);
  if (retried != null) return retried;

  // Someone else took the claim over first. MongoDB already has the full event, so
  // failing toward "not synced to ES" never blocks the batch indefinitely.
  return (await waitForDecision(activityId)) ?? 'dropped';
};
