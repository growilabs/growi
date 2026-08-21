import EventEmitter from 'node:events';
import { Types } from 'mongoose';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import type PageEvent from '~/server/events/page';
import type { PageDocument } from '~/server/models/page';

import { PageLinkService } from './page-link-service';

// handlePageUpsert has its own coverage (page-link-service-handlers.integ.ts); mock it so this
// test isolates the wiring contract — which events run it, with which arguments.
const mocks = vi.hoisted(() => ({
  handlePageUpsert: vi.fn(),
  loggerError: vi.fn(),
}));
vi.mock('./page-link-service-handlers', () => ({
  handlePageUpsert: mocks.handlePageUpsert,
}));
vi.mock('~/utils/logger', () => ({
  default: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: mocks.loggerError,
  }),
}));

describe('PageLinkService (event wiring)', () => {
  const siteUrl = 'https://wiki.example';

  // Subscribe against a real emitter so registered listeners actually fire on emit.
  // The cast is confined to this one field: mock<T>() cannot supply working
  // EventEmitter behavior, and PageLinkService only touches events.page here.
  const subscribe = () => {
    const pageEvent = new EventEmitter();
    const crowi = mock<Crowi>({
      events: { page: pageEvent as unknown as PageEvent },
      configManager: { getConfig: vi.fn().mockReturnValue(siteUrl) },
    });
    PageLinkService.create(crowi);
    return pageEvent;
  };

  // onUpsert is invoked without await from the listener; let its microtasks settle.
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  const page = (): PageDocument =>
    mock<PageDocument>({ _id: new Types.ObjectId(), path: '/from' });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    'create',
    'update',
  ] as const)('runs the upsert handler with the configured siteUrl on a %s event', async (event) => {
    const pageEvent = subscribe();
    const p = page();

    pageEvent.emit(event, p);
    await flush();

    expect(mocks.handlePageUpsert).toHaveBeenCalledTimes(1);
    expect(mocks.handlePageUpsert).toHaveBeenCalledWith(p, siteUrl);
  });

  it('swallows and logs a handler failure instead of propagating it', async () => {
    const pageEvent = subscribe();
    const err = new Error('boom');
    mocks.handlePageUpsert.mockRejectedValueOnce(err);

    pageEvent.emit('create', page());
    await flush();

    // The rejection is caught and logged, never left to propagate as an
    // unhandled rejection (removing onUpsert's try/catch fails this).
    expect(mocks.loggerError).toHaveBeenCalledTimes(1);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ err }),
      expect.any(String),
    );
  });
});
