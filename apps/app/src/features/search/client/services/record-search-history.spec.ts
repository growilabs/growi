import { mutate } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiv3Post } from '~/client/util/apiv3-client';
import type { ISearchHistory } from '~/features/search/interfaces/search-history';

import { SEARCH_HISTORIES_CACHE_KEY } from '../stores/search-history-cache-key';
import { recordSearchHistory } from './record-search-history';

vi.mock('~/client/util/apiv3-client', () => ({ apiv3Post: vi.fn() }));
vi.mock('~/client/util/toastr', () => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

const history = (_id: string, keyword: string): ISearchHistory => ({
  _id,
  keyword,
  lastSearchedAt: new Date('2026-10-30T00:00:00.000Z'),
});

const readCache = (): Promise<ISearchHistory[] | undefined> =>
  mutate<ISearchHistory[]>(SEARCH_HISTORIES_CACHE_KEY, (current) => current, {
    revalidate: false,
  });

const seedCache = (data: ISearchHistory[] | undefined): Promise<unknown> =>
  mutate(SEARCH_HISTORIES_CACHE_KEY, data, { revalidate: false });

const respondWith = (searchHistory: ISearchHistory): void => {
  vi.mocked(apiv3Post).mockResolvedValue({
    data: { searchHistory },
  } as Awaited<ReturnType<typeof apiv3Post>>);
};

// recordSearchHistory is fire-and-forget, so wait for its promise chain to settle
const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve));

describe('recordSearchHistory', () => {
  beforeEach(async () => {
    vi.mocked(apiv3Post).mockReset();
    await seedCache(undefined);
  });

  afterEach(async () => {
    await seedCache(undefined);
  });

  it('returns synchronously without awaiting the API', () => {
    vi.mocked(apiv3Post).mockReturnValue(new Promise(() => {}));

    expect(recordSearchHistory('foo')).toBeUndefined();
    expect(apiv3Post).toHaveBeenCalledWith('/search-history', {
      keyword: 'foo',
    });
  });

  it('does not reject or throw when the API fails', async () => {
    vi.mocked(apiv3Post).mockRejectedValue(new Error('network down'));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    try {
      expect(() => recordSearchHistory('foo')).not.toThrow();
      await flush();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('shows no toast when the API fails', async () => {
    const { toastError } = await import('~/client/util/toastr');
    vi.mocked(apiv3Post).mockRejectedValue(new Error('boom'));

    recordSearchHistory('foo');
    await flush();

    expect(toastError).not.toHaveBeenCalled();
  });

  it('leaves the cache untouched when the API fails', async () => {
    const cached = [history('a', 'alpha')];
    await seedCache(cached);
    vi.mocked(apiv3Post).mockRejectedValue(new Error('boom'));

    recordSearchHistory('foo');
    await flush();

    expect(await readCache()).toEqual(cached);
  });

  it('puts the recorded history at the top of the cached list', async () => {
    await seedCache([history('a', 'alpha'), history('b', 'beta')]);
    respondWith(history('c', 'gamma'));

    recordSearchHistory('gamma');
    await flush();

    expect((await readCache())?.map((h) => h._id)).toEqual(['c', 'a', 'b']);
  });

  it('moves an item with the same id to the top without duplicating it', async () => {
    await seedCache([
      history('a', 'alpha'),
      history('b', 'beta'),
      history('c', 'gamma'),
    ]);
    respondWith(history('b', 'beta'));

    recordSearchHistory('beta');
    await flush();

    expect((await readCache())?.map((h) => h._id)).toEqual(['b', 'a', 'c']);
  });

  it('does nothing to the cache when the list has not been fetched yet', async () => {
    respondWith(history('c', 'gamma'));

    recordSearchHistory('gamma');
    await flush();

    expect(await readCache()).toBeUndefined();
  });
});
