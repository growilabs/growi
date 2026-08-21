import { Types } from 'mongoose';

import { PageLinkUpsertQueue } from './page-link-upsert-queue';

// handlePageUpsertById has its own coverage (page-link-service-handlers.integ.ts); mock it so this
// spec isolates the pacing contract. The mock's resolved value IS the extraction cost paced on.
const mocks = vi.hoisted(() => ({
  handlePageUpsertById: vi.fn(),
  loggerError: vi.fn(),
}));
vi.mock('./page-link-service-handlers', () => ({
  handlePageUpsertById: mocks.handlePageUpsertById,
}));
vi.mock('~/utils/logger', () => ({
  default: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: mocks.loggerError,
  }),
}));

/*
 * B2.2 — the queue holds itself to a duty cycle over measured extraction time (requirement 3.5).
 * Contract: after each page it rests long enough to keep its share of the loop at the configured
 * percentage, so cost per page decides the pace instead of a fixed page budget.
 */
describe('PageLinkUpsertQueue (duty-cycle pacing)', () => {
  const siteUrl = 'https://wiki.example';
  const DRAIN_INTERVAL_MS = 500;
  const DUTY_CYCLE_PERCENT = 20;

  const EXTRACTION_MS = 10;
  // At 20% duty the queue owes 4ms of rest per ms worked, so a 10ms extraction rests 40ms.
  const REST_MS =
    (EXTRACTION_MS * (100 - DUTY_CYCLE_PERCENT)) / DUTY_CYCLE_PERCENT;

  const createQueue = (dutyCyclePercent = DUTY_CYCLE_PERCENT) =>
    new PageLinkUpsertQueue(() => siteUrl, {
      drainIntervalMs: DRAIN_INTERVAL_MS,
      dutyCyclePercent,
    });

  const enqueuePages = (queue: PageLinkUpsertQueue, count: number): void => {
    for (let i = 0; i < count; i++) {
      queue.enqueue(new Types.ObjectId().toString());
    }
  };

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.handlePageUpsertById.mockReset();
    mocks.handlePageUpsertById.mockResolvedValue(EXTRACTION_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds the next page back for the rest its predecessor earned', async () => {
    const queue = createQueue();

    enqueuePages(queue, 2);
    await vi.advanceTimersByTimeAsync(DRAIN_INTERVAL_MS);
    expect(mocks.handlePageUpsertById).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(REST_MS - 1);
    expect(mocks.handlePageUpsertById).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.handlePageUpsertById).toHaveBeenCalledTimes(2);
  });

  it('scales the rest with what the page actually cost', async () => {
    const queue = createQueue();
    // Ten times the extraction earns ten times the rest — the property a page budget cannot
    // express.
    mocks.handlePageUpsertById.mockResolvedValue(EXTRACTION_MS * 10);

    enqueuePages(queue, 2);
    await vi.advanceTimersByTimeAsync(DRAIN_INTERVAL_MS);

    await vi.advanceTimersByTimeAsync(REST_MS * 10 - 1);
    expect(mocks.handlePageUpsertById).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.handlePageUpsertById).toHaveBeenCalledTimes(2);
  });

  it('does not rest for a page that was skipped without extracting', async () => {
    const queue = createQueue();
    // What a trashed or already-deleted source reports: no work done, so nothing owed.
    mocks.handlePageUpsertById.mockResolvedValue(0);

    enqueuePages(queue, 3);
    await vi.advanceTimersByTimeAsync(DRAIN_INTERVAL_MS);

    expect(mocks.handlePageUpsertById).toHaveBeenCalledTimes(3);
  });

  it('never rests at a 100% duty cycle', async () => {
    const queue = createQueue(100);

    enqueuePages(queue, 3);
    await vi.advanceTimersByTimeAsync(DRAIN_INTERVAL_MS);

    expect(mocks.handlePageUpsertById).toHaveBeenCalledTimes(3);
  });

  it('picks up a site URL change part-way through a drain', async () => {
    let siteUrlNow = 'https://before.example';
    const queue = new PageLinkUpsertQueue(() => siteUrlNow, {
      drainIntervalMs: DRAIN_INTERVAL_MS,
      dutyCyclePercent: 100,
    });
    // A drain runs until the queue is empty, so reading the URL once per drain would apply a stale
    // value to every remaining page.
    mocks.handlePageUpsertById.mockImplementation(() => {
      siteUrlNow = 'https://after.example';
      return Promise.resolve(0);
    });

    enqueuePages(queue, 2);
    await vi.advanceTimersByTimeAsync(DRAIN_INTERVAL_MS);

    expect(
      mocks.handlePageUpsertById.mock.calls.map(([, siteUrl]) => siteUrl),
    ).toEqual(['https://before.example', 'https://after.example']);
  });

  it('caps one rest so an absurd measurement cannot wedge the drain', async () => {
    const queue = createQueue();
    // A host stall, not a real parse cost: uncapped this would rest for hours.
    mocks.handlePageUpsertById.mockResolvedValue(60 * 60 * 1000);

    enqueuePages(queue, 2);
    await vi.advanceTimersByTimeAsync(DRAIN_INTERVAL_MS);

    await vi.advanceTimersByTimeAsync(10_000 - 1);
    expect(mocks.handlePageUpsertById).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.handlePageUpsertById).toHaveBeenCalledTimes(2);
  });
});
