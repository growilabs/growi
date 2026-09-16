import mongoose from 'mongoose';

import { AnonymousSyncCounter } from '../models/anonymous-sync-counter';
import { EsSyncDecision } from '../models/es-sync-decision';
import { decideEsSyncForEvent } from './decide-es-sync-for-event';

const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));

vi.mock('~/utils/logger', () => ({
  default: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: mockWarn,
    error: vi.fn(),
  })),
}));

describe('decideEsSyncForEvent', () => {
  const endpoint = '/login';
  const windowStart = new Date('2026-01-01T00:00:00Z');

  afterEach(async () => {
    await AnonymousSyncCounter.deleteMany({});
    await EsSyncDecision.deleteMany({});
    mockWarn.mockClear();
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

  it('skips the per-event claim entirely once the window is confidently past threshold', async () => {
    const threshold = 3;
    for (let i = 0; i < 4; i++) {
      // biome-ignore lint/performance/noAwaitInLoops: each call must see the prior one's committed count.
      await decideEsSyncForEvent(
        newActivityId(),
        endpoint,
        windowStart,
        threshold,
      );
    }
    // The counter is now at 4 (> threshold), so the next call should take the
    // cheap early-out path — no EsSyncDecision record created for it at all.
    const skippedActivityId = newActivityId();
    const decision = await decideEsSyncForEvent(
      skippedActivityId,
      endpoint,
      windowStart,
      threshold,
    );

    expect(decision).toBe('dropped');
    expect(await EsSyncDecision.exists({ _id: skippedActivityId })).toBeNull();
  });

  it('does not double-increment when two processes race on the exact same event concurrently', async () => {
    const activityId = newActivityId();
    const threshold = 3;

    const [first, second] = await Promise.all([
      decideEsSyncForEvent(activityId, endpoint, windowStart, threshold),
      decideEsSyncForEvent(activityId, endpoint, windowStart, threshold),
    ]);

    // Both calls are for the SAME event, so exactly one of them actually claims
    // and increments; the other must read that same result back, never decide
    // independently.
    expect(first).toBe(second);
    expect(
      (await AnonymousSyncCounter.findOne({ endpoint, windowStart }))?.count,
    ).toBe(1);
  });

  it('logs a warning exactly once, at the event that first crosses the threshold', async () => {
    const threshold = 3;
    for (let i = 0; i < 5; i++) {
      // biome-ignore lint/performance/noAwaitInLoops: each call must see the prior one's committed count.
      await decideEsSyncForEvent(
        newActivityId(),
        endpoint,
        windowStart,
        threshold,
      );
    }

    // Not once per dropped event (2 of the 5 were dropped) — a sustained attack
    // must not flood the log with one line per event.
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint, windowStart, threshold }),
      expect.any(String),
    );
  });

  it('does not log when every event in the window is admitted', async () => {
    await decideEsSyncForEvent(newActivityId(), endpoint, windowStart, 3);
    await decideEsSyncForEvent(newActivityId(), endpoint, windowStart, 3);

    expect(mockWarn).not.toHaveBeenCalled();
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
      claimToken: 'stale-claimant-token',
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
      claimToken: 'fresh-claimant-token',
    });

    const decision = await decideEsSyncForEvent(
      activityId,
      endpoint,
      windowStart,
      /* threshold */ 3,
    );

    expect(decision).toBe('dropped');
  }, 10_000);

  it('does not double-increment the counter when the claim is stolen while this call is about to finalize', async () => {
    const activityId = newActivityId();
    const threshold = 3;

    // Simulate a call that successfully claimed the event but then stalled for long
    // enough (e.g. a GC pause) that another process treated the claim as abandoned,
    // stole it, and already decided + incremented the counter on its own — all
    // between this call's claim and its own reconfirm-before-increment step.
    type FindOneAndUpdateFn = typeof EsSyncDecision.findOneAndUpdate;
    type LooseFindOneAndUpdate = (
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => Promise<unknown>;
    // Mongoose's findOneAndUpdate returns a lazily-executed Query (thenable, not a real
    // Promise), so it cannot be cast directly to a Promise-returning function type —
    // bridge via `unknown` as TypeScript's own overlap check suggests.
    const originalFindOneAndUpdate = EsSyncDecision.findOneAndUpdate.bind(
      EsSyncDecision,
    ) as unknown as LooseFindOneAndUpdate;
    const spy = vi
      .spyOn(EsSyncDecision, 'findOneAndUpdate')
      .mockImplementation((async (
        filter: Record<string, unknown>,
        update: Record<string, unknown>,
        options?: Record<string, unknown>,
      ) => {
        const isReconfirmCall = filter != null && 'claimToken' in filter;
        if (isReconfirmCall) {
          // A thief process stole the claim (fresh token, already decided) right
          // before this call's own reconfirm executes.
          await EsSyncDecision.updateOne(
            { _id: activityId },
            {
              $set: {
                claimToken: 'thief-token',
                decision: 'admitted',
              },
            },
          );
          await AnonymousSyncCounter.findOneAndUpdate(
            { endpoint, windowStart },
            { $inc: { count: 1 } },
            { upsert: true },
          );
        }
        return originalFindOneAndUpdate(filter, update, options);
      }) as unknown as FindOneAndUpdateFn);

    try {
      const decision = await decideEsSyncForEvent(
        activityId,
        endpoint,
        windowStart,
        threshold,
      );

      // Defers to the thief's own decision instead of forcing its own.
      expect(decision).toBe('admitted');
      // The counter was incremented once by the thief, and NOT a second time by this
      // call after it lost the claim.
      expect(
        (await AnonymousSyncCounter.findOne({ endpoint, windowStart }))?.count,
      ).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});
