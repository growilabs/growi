import EventEmitter from 'node:events';
import { Types } from 'mongoose';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import type PageEvent from '~/server/events/page';
import type { PageDocument } from '~/server/models/page';

import { PageLinkService } from './page-link-service';

// handlePageUpsertById has its own coverage (page-link-service-handlers.integ.ts); mock it so this
// test isolates the queue contract — which pages are extracted, how often, and how many per tick.
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
 * B2.2 — live extraction is coalesced and paced (requirement 3.5).
 * Contract: a create/update event marks the page dirty; a paced tick drains a bounded number of
 * ids per cycle and upserts each once, off the response path.
 */
describe('PageLinkService (live extraction queue)', () => {
  const siteUrl = 'https://wiki.example';

  // Deliberately not the shipped default (1000): the assertions below only hold if the queue
  // paces on the configured value rather than on a constant of its own.
  const DRAIN_INTERVAL_MS = 500;

  const configValues: Record<string, string | number> = {
    'app:siteUrl': siteUrl,
    'backlinks:drainIntervalMs': DRAIN_INTERVAL_MS,
    // 100% duty means the queue never rests: pacing is covered in page-link-upsert-queue.spec.ts,
    // and this file is about which pages get drained, not when.
    'backlinks:dutyCyclePercent': 100,
  };

  let pageEvent: EventEmitter;

  // Subscribes against a real emitter so registered listeners actually fire on emit.
  // The cast is confined to this one field: mock<T>() cannot supply working
  // EventEmitter behavior, and PageLinkService only touches events.page here.
  const createService = (
    events: EventEmitter,
    configOverrides: Record<string, string | number> = {},
  ): void => {
    const crowi = mock<Crowi>({
      events: { page: events as unknown as PageEvent },
      configManager: {
        // mockImplementation rather than vi.fn(impl): getConfig is generic over the config key,
        // and a concrete implementation signature is not assignable to it.
        getConfig: vi
          .fn()
          .mockImplementation(
            (key: string) => ({ ...configValues, ...configOverrides })[key],
          ),
      },
    });
    PageLinkService.create(crowi);
  };

  beforeEach(() => {
    vi.useFakeTimers();

    pageEvent = new EventEmitter();
    createService(pageEvent);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const save = (
    event: 'create' | 'update',
    pageId: Types.ObjectId,
    emitter: EventEmitter = pageEvent,
  ): void => {
    const page = mock<PageDocument>({ path: '/from' });
    // Assign the ObjectId directly: mock<T>() would deep-mock it into a proxy, so toString()
    // would no longer yield the id the queue keys on.
    page._id = pageId;
    emitter.emit(event, page);
  };

  const upsertedIds = (): string[] =>
    mocks.handlePageUpsertById.mock.calls.map(([pageId]) => pageId);

  it.each([
    'create',
    'update',
  ] as const)('defers a %s event to the drain tick and upserts the page once', async (event) => {
    const pageId = new Types.ObjectId();

    save(event, pageId);

    // Extraction must not run inline in the event callback (the B1 behavior this replaces).
    await vi.advanceTimersByTimeAsync(DRAIN_INTERVAL_MS - 1);
    expect(mocks.handlePageUpsertById).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.handlePageUpsertById).toHaveBeenCalledTimes(1);
    expect(mocks.handlePageUpsertById).toHaveBeenCalledWith(
      pageId.toString(),
      siteUrl,
    );
  });

  it('collapses repeated saves of the same page within the tick window into one extraction', async () => {
    const pageId = new Types.ObjectId();

    save('update', pageId);
    await vi.advanceTimersByTimeAsync(DRAIN_INTERVAL_MS / 2);
    save('update', pageId);
    save('update', pageId);

    await vi.advanceTimersByTimeAsync(DRAIN_INTERVAL_MS);

    // The upsert is idempotent last-writer-wins, so the intermediate saves carry no information.
    expect(mocks.handlePageUpsertById).toHaveBeenCalledTimes(1);
  });

  it('drains a whole burst, extracting each page exactly once', async () => {
    const pageIds = Array.from({ length: 7 }, () => new Types.ObjectId());

    for (const pageId of pageIds) {
      save('create', pageId);
    }

    await vi.advanceTimersByTimeAsync(DRAIN_INTERVAL_MS);

    // Sorted comparison: drain order is not part of the contract, but every page must be
    // extracted exactly once (a mismatch catches both dropped and duplicated ids).
    expect(upsertedIds().sort()).toEqual(
      pageIds.map((pageId) => pageId.toString()).sort(),
    );
  });

  it('processes a page saved while a drain is in flight on a later tick', async () => {
    const inFlight = new Types.ObjectId();
    const late = new Types.ObjectId();
    let releaseInFlight = (): void => {};
    mocks.handlePageUpsertById.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseInFlight = () => resolve();
        }),
    );

    save('update', inFlight);
    await vi.advanceTimersByTimeAsync(DRAIN_INTERVAL_MS);

    // Arrives mid-drain, when no new tick can be scheduled yet — it must not be lost.
    save('update', late);
    releaseInFlight();
    await vi.advanceTimersByTimeAsync(DRAIN_INTERVAL_MS);

    expect(upsertedIds()).toEqual([inFlight.toString(), late.toString()]);
  });

  it('re-extracts a page saved again while its own upsert is in flight', async () => {
    const pageId = new Types.ObjectId();
    let releaseInFlight = (): void => {};
    mocks.handlePageUpsertById.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseInFlight = () => resolve();
        }),
    );

    save('update', pageId);
    await vi.advanceTimersByTimeAsync(DRAIN_INTERVAL_MS);

    // This save's body landed after the in-flight run read the page, so it needs a run of its
    // own — otherwise the newest body is never indexed (until some later edit).
    save('update', pageId);
    releaseInFlight();
    await vi.advanceTimersByTimeAsync(DRAIN_INTERVAL_MS);

    expect(upsertedIds()).toEqual([pageId.toString(), pageId.toString()]);
  });

  it('logs a failing page and still upserts the rest of the batch', async () => {
    const failing = new Types.ObjectId();
    const healthy = new Types.ObjectId();
    const err = new Error('boom');
    mocks.handlePageUpsertById.mockRejectedValueOnce(err);

    save('create', failing);
    save('create', healthy);
    await vi.advanceTimersByTimeAsync(DRAIN_INTERVAL_MS);

    expect(upsertedIds()).toEqual([failing.toString(), healthy.toString()]);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ err, pageId: failing.toString() }),
      expect.any(String),
    );
  });

  it('keeps accepting saves after a drain failure instead of wedging the queue', async () => {
    // Mirrors the queue's RETRY_BACKOFF_MS. A drain that failed waits this long before running
    // again, and since the queue has a single drain timer, a save arriving in the meantime waits
    // with it — intended, and the reason this advances further than one interval.
    const RETRY_BACKOFF_MS = 5000;
    mocks.handlePageUpsertById.mockRejectedValueOnce(new Error('boom'));
    save('create', new Types.ObjectId());
    await vi.advanceTimersByTimeAsync(DRAIN_INTERVAL_MS);

    const next = new Types.ObjectId();
    save('create', next);
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS);

    expect(mocks.handlePageUpsertById).toHaveBeenLastCalledWith(
      next.toString(),
      siteUrl,
    );
  });
});
