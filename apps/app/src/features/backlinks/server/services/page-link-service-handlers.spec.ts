import { Types } from 'mongoose';

import { BULK_REINDEX_SIZE } from '~/server/service/page/consts';

import { handlePagesDelete } from './page-link-service-handlers';
import { reconcileDeletedPages } from './page-link-sync';

// reconcileDeletedPages is the boundary here: its size precondition (via removeLinksForPages) is
// the contract this handler exists to uphold. The row changes themselves are covered in
// page-link-sync.spec.ts and page-link-service-handlers.integ.ts.
vi.mock('./page-link-sync', () => ({
  reconcileDeletedPages: vi.fn(),
  reResolveByToPath: vi.fn(),
  syncOutboundLinks: vi.fn(),
}));

// Fake timers patch the global setTimeout but not node:timers/promises, so the backoff sleep would
// run in real time.
vi.mock('node:timers/promises', () => ({
  setTimeout: (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    }),
}));

const mocks = vi.hoisted(() => ({ loggerError: vi.fn() }));
vi.mock('~/utils/logger', () => ({
  default: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: mocks.loggerError,
  }),
}));

/*
 * B5.3 — contract: a delete-family payload reaches reconcile in calls of at most
 * BULK_REINDEX_SIZE ids, every id exactly once, however large the payload. Group deletion sends
 * every affected page in one syncDescendantsDelete payload, so the size is not bounded upstream.
 */
describe('handlePagesDelete', () => {
  // Not a multiple of the chunk size, so a partial last chunk is exercised too.
  const OVERSIZED = BULK_REINDEX_SIZE * 2 + 50;

  const pageIdsOf = (count: number): Types.ObjectId[] =>
    Array.from({ length: count }, () => new Types.ObjectId());

  const callSizes = (): number[] =>
    vi.mocked(reconcileDeletedPages).mock.calls.map(([ids]) => ids.length);

  /** Every id handed to reconcileDeletedPages, across all calls, as sorted hex: order is not the contract. */
  const idsReconciled = (): string[] =>
    vi
      .mocked(reconcileDeletedPages)
      .mock.calls.flatMap(([ids]) => ids)
      .map((id) => id.toString())
      .sort();

  const hexSorted = (ids: Types.ObjectId[]): string[] =>
    ids.map((id) => id.toString()).sort();

  /** Calls whose chunk contains the id, as hex lists: identifies a chunk by content, not by call order. */
  const callsContaining = (target: Types.ObjectId): string[][] =>
    vi
      .mocked(reconcileDeletedPages)
      .mock.calls.filter(([ids]) => ids.some((id) => id.equals(target)))
      .map(([ids]) => ids.map((id) => id.toString()));

  beforeEach(() => {
    vi.clearAllMocks();
    // mockReset, unlike clearAllMocks, also drops queued mockRejectedValueOnce values and
    // implementations, so one test's leftovers cannot reach the next.
    vi.mocked(reconcileDeletedPages).mockReset();
    vi.mocked(reconcileDeletedPages).mockResolvedValue(undefined);
  });

  it('never hands reconcile more than BULK_REINDEX_SIZE ids in one call', async () => {
    await handlePagesDelete(pageIdsOf(OVERSIZED));

    // Non-empty first: with no calls at all, every size check below would hold vacuously.
    expect(callSizes().length).toBeGreaterThan(0);
    for (const size of callSizes()) {
      expect(size).toBeLessThanOrEqual(BULK_REINDEX_SIZE);
    }
  });

  it('reconciles every id of an oversized payload exactly once', async () => {
    const pageIds = pageIdsOf(OVERSIZED);

    await handlePagesDelete(pageIds);

    expect(idsReconciled()).toEqual(hexSorted(pageIds));
  });

  describe('when reconcile fails', () => {
    const MAX_ATTEMPTS = 5;
    const BACKOFF_MS = 5000;

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('hands the failed chunk to reconcile again, and every id ends up reconciled without an error', async () => {
      const pageIds = pageIdsOf(OVERSIZED);
      const [target] = pageIds;
      let hasFailed = false;
      vi.mocked(reconcileDeletedPages).mockImplementation((ids) => {
        if (!hasFailed && ids.some((id) => id.equals(target))) {
          hasFailed = true;
          return Promise.reject(new Error('transient'));
        }
        return Promise.resolve();
      });

      const settled = handlePagesDelete(pageIds);
      await vi.runAllTimersAsync();
      await expect(settled).resolves.toBeUndefined();

      const [firstAttempt, secondAttempt, ...rest] = callsContaining(target);
      expect(rest).toHaveLength(0);
      expect(secondAttempt).toEqual(firstAttempt);
      expect(new Set(idsReconciled())).toEqual(new Set(hexSorted(pageIds)));
      expect(mocks.loggerError).not.toHaveBeenCalled();
    });

    it('waits for the backoff before retrying', async () => {
      vi.mocked(reconcileDeletedPages).mockRejectedValueOnce(
        new Error('transient'),
      );

      const settled = handlePagesDelete(pageIdsOf(1));

      await vi.advanceTimersByTimeAsync(BACKOFF_MS - 1);
      expect(reconcileDeletedPages).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(reconcileDeletedPages).toHaveBeenCalledTimes(2);

      await settled;
    });

    it('gives up on a chunk after the maximum attempts, logs it once, and still settles the other chunks', async () => {
      const pageIds = pageIdsOf(OVERSIZED);
      const [target] = pageIds;
      const failure = new Error('persistent');
      vi.mocked(reconcileDeletedPages).mockImplementation((ids) =>
        ids.some((id) => id.equals(target))
          ? Promise.reject(failure)
          : Promise.resolve(),
      );

      const settled = handlePagesDelete(pageIds);
      await vi.runAllTimersAsync();
      await expect(settled).resolves.toBeUndefined();

      expect(callsContaining(target)).toHaveLength(MAX_ATTEMPTS);
      // Swallowed without a log, the stale rows it leaves behind would be undiagnosable.
      expect(mocks.loggerError).toHaveBeenCalledTimes(1);
      expect(mocks.loggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          err: failure,
          pageIds: expect.arrayContaining([target]),
        }),
        expect.any(String),
      );
      // Every id was handed over at least once, so the other chunks were not abandoned with it.
      expect(new Set(idsReconciled())).toEqual(new Set(hexSorted(pageIds)));
    });
  });
});
