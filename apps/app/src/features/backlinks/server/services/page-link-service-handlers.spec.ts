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

  beforeEach(() => {
    vi.clearAllMocks();
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

  it('still settles the other chunks when one chunk fails, and reports the failure', async () => {
    const pageIds = pageIdsOf(OVERSIZED);
    const failure = new Error('transient');
    vi.mocked(reconcileDeletedPages).mockRejectedValueOnce(failure);

    await expect(handlePagesDelete(pageIds)).resolves.toBeUndefined();

    // The failed chunk was handed over too, so every id still appears exactly once.
    expect(idsReconciled()).toEqual(hexSorted(pageIds));
    // Swallowed without a log, the stale rows it leaves behind would be undiagnosable.
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ err: failure }),
      expect.any(String),
    );
  });
});
