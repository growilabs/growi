import mongoose from 'mongoose';

import { AnonymousSyncCounter } from '../models/anonymous-sync-counter';
import { EsSyncDecision } from '../models/es-sync-decision';
import { decideEsSyncForEvent } from './decide-es-sync-for-event';

describe('decideEsSyncForEvent', () => {
  const endpoint = '/login';
  const windowStart = new Date('2026-01-01T00:00:00Z');

  afterEach(async () => {
    await AnonymousSyncCounter.deleteMany({});
    await EsSyncDecision.deleteMany({});
  });

  const newActivityId = (): string => new mongoose.Types.ObjectId().toString();

  it('admits an event when the window is under threshold', async () => {
    const decision = await decideEsSyncForEvent(
      newActivityId(),
      endpoint,
      windowStart,
      /* threshold */ 3,
    );

    expect(decision).toBe('admitted');
  });

  it('admits exactly up to the threshold and drops beyond it', async () => {
    const threshold = 3;
    const decisions: string[] = [];
    for (let i = 0; i < 5; i++) {
      // biome-ignore lint/performance/noAwaitInLoops: each call must see the prior one's committed count.
      const decision = await decideEsSyncForEvent(
        newActivityId(),
        endpoint,
        windowStart,
        threshold,
      );
      decisions.push(decision);
    }

    expect(decisions).toEqual([
      'admitted',
      'admitted',
      'admitted',
      'dropped',
      'dropped',
    ]);
  });

  it('does not admit past the threshold for a different endpoint sharing the same window', async () => {
    const threshold = 1;
    await decideEsSyncForEvent(
      newActivityId(),
      '/login',
      windowStart,
      threshold,
    );
    const otherEndpointDecision = await decideEsSyncForEvent(
      newActivityId(),
      '/register',
      windowStart,
      threshold,
    );

    // '/register' has its own counter, so it is unaffected by '/login' already
    // being at capacity — this is the whole point of keying the counter by endpoint.
    expect(otherEndpointDecision).toBe('admitted');
  });

  it('is idempotent for the same event decided more than once (redundant multi-process processing)', async () => {
    const activityId = newActivityId();
    const threshold = 1;

    const first = await decideEsSyncForEvent(
      activityId,
      endpoint,
      windowStart,
      threshold,
    );
    // A second GROWI process independently processing the same change-stream event
    // for the same activity — this must not consume a second slot in the counter.
    const second = await decideEsSyncForEvent(
      activityId,
      endpoint,
      windowStart,
      threshold,
    );

    expect(first).toBe('admitted');
    expect(second).toBe('admitted');

    // A distinct event at the same (already-exhausted) threshold must be dropped —
    // proving the counter was only ever incremented once for the duplicate above,
    // not twice.
    const distinctEventDecision = await decideEsSyncForEvent(
      newActivityId(),
      endpoint,
      windowStart,
      threshold,
    );
    expect(distinctEventDecision).toBe('dropped');
  });

  it('recovers a stale pending claim (the original claimant crashed before finalizing)', async () => {
    const activityId = newActivityId();
    // Simulate an abandoned claim: a process inserted 'pending' but never finalized it.
    await EsSyncDecision.create({
      _id: activityId,
      endpoint,
      windowStart,
      decision: 'pending',
      claimedAt: new Date(Date.now() - 10_000),
    });

    const decision = await decideEsSyncForEvent(
      activityId,
      endpoint,
      windowStart,
      /* threshold */ 3,
    );

    // A real decision ('admitted', not the timeout fallback 'dropped') proves this
    // call took over the stale claim and ran the actual admit/drop logic itself,
    // rather than merely waiting out the poll timeout.
    expect(decision).toBe('admitted');
    expect(
      (await AnonymousSyncCounter.findOne({ endpoint, windowStart }))?.count,
    ).toBe(1);
  });

  it('fails safe to dropped when a fresh pending claim never resolves', async () => {
    const activityId = newActivityId();
    // A claim that is NOT stale yet (just made) and is never finalized — e.g. its
    // owning process is still mid-flight, or died after claiming but within the
    // grace period. A waiter must not hang forever or throw; it fails toward
    // "not synced to ES" (MongoDB already has the full record either way).
    await EsSyncDecision.create({
      _id: activityId,
      endpoint,
      windowStart,
      decision: 'pending',
      claimedAt: new Date(),
    });

    const decision = await decideEsSyncForEvent(
      activityId,
      endpoint,
      windowStart,
      /* threshold */ 3,
    );

    expect(decision).toBe('dropped');
  }, 10_000);
});
