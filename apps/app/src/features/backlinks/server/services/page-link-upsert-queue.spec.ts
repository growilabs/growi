import { performance } from 'node:perf_hooks';
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

  // Mirrors the module's MAX_UPSERT_ATTEMPTS / RETRY_BACKOFF_MS, so a change to either fails here
  // rather than silently altering how long a failing page is chased.
  const MAX_UPSERT_ATTEMPTS = 5;
  const RETRY_BACKOFF_MS = 5000;
  const MAX_CHARGED_EXTRACTION_MS = 5000;

  it('retries a failed page after a backoff rather than dropping it', async () => {
    // 100% duty so no rest is owed: a failure's own rest would otherwise shift the drain timeline
    // and this test would pass whether or not the backoff exists.
    const queue = createQueue(100);
    mocks.handlePageUpsertById
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue(0);
    const pageId = new Types.ObjectId().toString();

    queue.enqueue(pageId);
    await vi.advanceTimersByTimeAsync(DRAIN_INTERVAL_MS);
    expect(mocks.handlePageUpsertById).toHaveBeenCalledTimes(1);

    // Not on the next ordinary tick: a database that just failed is not retried every second.
    await vi.advanceTimersByTimeAsync(DRAIN_INTERVAL_MS);
    expect(mocks.handlePageUpsertById).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS);
    expect(mocks.handlePageUpsertById).toHaveBeenNthCalledWith(
      2,
      pageId,
      siteUrl,
    );
  });

  it('stops retrying a page that succeeded on a later attempt', async () => {
    const queue = createQueue();
    mocks.handlePageUpsertById
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue(0);

    queue.enqueue(new Types.ObjectId().toString());
    await vi.advanceTimersByTimeAsync(
      DRAIN_INTERVAL_MS + RETRY_BACKOFF_MS * 20,
    );

    // One failure plus one successful retry. Anything more means the retry bookkeeping outlives
    // the drain that created it, which leaves the page re-extracting on every tick forever.
    expect(mocks.handlePageUpsertById).toHaveBeenCalledTimes(2);
  });

  it('does not re-extract a page that failed and then succeeded in the same drain', async () => {
    // A save landing mid-drain re-enqueues the id, and the live Set revisits it in the same pass,
    // so a page can fail and then succeed within one drain. It must not also be re-queued as a
    // failure afterwards.
    const queue = createQueue(100);
    const pageId = new Types.ObjectId().toString();
    let attempt = 0;
    mocks.handlePageUpsertById.mockImplementation(() => {
      attempt += 1;
      if (attempt === 1) {
        queue.enqueue(pageId);
        return Promise.reject(new Error('transient'));
      }
      return Promise.resolve(0);
    });

    queue.enqueue(pageId);
    await vi.advanceTimersByTimeAsync(DRAIN_INTERVAL_MS + RETRY_BACKOFF_MS * 4);

    expect(mocks.handlePageUpsertById).toHaveBeenCalledTimes(2);
  });

  it('does not let saves during a fault exhaust the retry budget', async () => {
    // A save means the page changed — new work, not another attempt at the same work. Counting it
    // against the budget would abandon a page that is merely being edited while writes are failing.
    const queue = createQueue(100);
    const pageId = new Types.ObjectId().toString();
    let saves = 0;
    mocks.handlePageUpsertById.mockImplementation(() => {
      if (saves++ < MAX_UPSERT_ATTEMPTS + 1) queue.enqueue(pageId);
      return Promise.reject(new Error('write fault'));
    });

    queue.enqueue(pageId);
    await vi.advanceTimersByTimeAsync(DRAIN_INTERVAL_MS);

    expect(mocks.loggerError).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('giving up'),
    );
  });

  it('gives up on a page that keeps failing, and says so', async () => {
    const queue = createQueue();
    mocks.handlePageUpsertById.mockRejectedValue(new Error('permanent'));
    const pageId = new Types.ObjectId().toString();

    queue.enqueue(pageId);
    await vi.advanceTimersByTimeAsync(
      DRAIN_INTERVAL_MS + RETRY_BACKOFF_MS * (MAX_UPSERT_ATTEMPTS + 5),
    );

    expect(mocks.handlePageUpsertById).toHaveBeenCalledTimes(
      MAX_UPSERT_ATTEMPTS,
    );
    // The operator has to be able to find the page the queue abandoned.
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ pageId, attempts: MAX_UPSERT_ATTEMPTS }),
      expect.stringContaining('giving up'),
    );
  });

  it('charges a failed page to the duty cycle', async () => {
    // Real timers: the queue charges failures by elapsed wall-clock, and vitest's fake timers do
    // not advance performance.now(), so a faked delay would register as no work at all.
    vi.useRealTimers();
    const FAILURE_MS = 50;
    const callTimes: number[] = [];

    // A failure can arrive after the extraction already ran, and the handler then never reports its
    // cost. Unpaced failures would be a parse spree exactly when the database is least healthy.
    mocks.handlePageUpsertById.mockImplementation(() => {
      callTimes.push(performance.now());
      if (callTimes.length > 1) return Promise.resolve(0);
      return new Promise((_, reject) => {
        setTimeout(() => reject(new Error('slow failure')), FAILURE_MS);
      });
    });

    const queue = new PageLinkUpsertQueue(() => siteUrl, {
      drainIntervalMs: 10,
      dutyCyclePercent: DUTY_CYCLE_PERCENT,
    });
    queue.enqueue(new Types.ObjectId().toString());
    queue.enqueue(new Types.ObjectId().toString());

    await vi.waitFor(() => expect(callTimes).toHaveLength(2), {
      timeout: 5000,
      interval: 10,
    });

    // The first page failed after ~FAILURE_MS of real work, which at 20% duty owes ~4x that before
    // the next page may start. Asserting half of the total keeps the bound safe on a loaded machine
    // while still failing outright if the failure went uncharged (the gap would be ~FAILURE_MS).
    expect(callTimes[1] - callTimes[0]).toBeGreaterThan(FAILURE_MS * 2);
  });

  it('bounds an absurd measurement without overriding the duty cycle', async () => {
    const queue = createQueue();
    // A host stall mid-extraction, not a real parse cost. Only the charged work is clamped, so the
    // configured duty still decides the rest — clamping the rest instead would silently raise the
    // effective duty for legitimately expensive pages, worst at a deliberately low setting.
    mocks.handlePageUpsertById.mockResolvedValue(60 * 60 * 1000);
    const cappedRestMs =
      (MAX_CHARGED_EXTRACTION_MS * (100 - DUTY_CYCLE_PERCENT)) /
      DUTY_CYCLE_PERCENT;

    enqueuePages(queue, 2);
    await vi.advanceTimersByTimeAsync(DRAIN_INTERVAL_MS);
    expect(mocks.handlePageUpsertById).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(cappedRestMs - 1);
    expect(mocks.handlePageUpsertById).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.handlePageUpsertById).toHaveBeenCalledTimes(2);
  });
});
