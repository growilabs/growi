import { AnonymousSyncCounter } from '../models/anonymous-sync-counter';
import type { EsSyncDecisionValue } from '../models/es-sync-decision';
import { EsSyncDecision } from '../models/es-sync-decision';

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
  const now = new Date();

  let holdsClaim = false;
  try {
    await EsSyncDecision.create({
      _id: activityId,
      endpoint,
      windowStart,
      decision: 'pending',
      claimedAt: now,
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
      { $set: { claimedAt: now } },
      { new: true },
    );
    holdsClaim = stolen != null;
  }

  if (!holdsClaim) {
    return waitForDecision(activityId);
  }

  // Holding the claim: this is the only call site that should ever $inc the
  // counter, and it runs at most once per distinct event (redundant processing
  // from other GROWI processes loses the claim race above and never reaches here).
  const after = await AnonymousSyncCounter.findOneAndUpdate(
    { endpoint, windowStart },
    { $inc: { count: 1 } },
    { upsert: true, new: true },
  );
  const decision: EsSyncDecisionValue =
    after.count <= threshold ? 'admitted' : 'dropped';
  await EsSyncDecision.updateOne({ _id: activityId }, { $set: { decision } });
  return decision;
};
