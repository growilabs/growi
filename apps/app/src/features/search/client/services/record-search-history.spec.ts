// biome-ignore lint/style/noRestrictedImports: Type-only import from axios
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import { mutate } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ISearchHistory } from '~/features/search/interfaces/search-history';
import axios from '~/utils/axios';

import { SEARCH_HISTORIES_CACHE_KEY } from '../stores/search-history-cache-key';
import { recordSearchHistory } from './record-search-history';

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

// Stub only the transport so the response still goes through the client's response transformers
const adapter = vi.fn<AxiosAdapter>();

const respondWith = (searchHistory: ISearchHistory): void => {
  adapter.mockImplementation(async (config) => ({
    data: JSON.stringify({ searchHistory }),
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  }));
};

const requestedKeywords = (): unknown[] =>
  adapter.mock.calls.map(
    ([config]) =>
      JSON.parse((config as InternalAxiosRequestConfig).data).keyword,
  );

// recordSearchHistory is fire-and-forget, so wait for its promise chain to settle
const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve));

describe('recordSearchHistory', () => {
  const originalAdapter = axios.defaults.adapter;

  beforeEach(async () => {
    adapter.mockReset();
    axios.defaults.adapter = adapter;
    await seedCache(undefined);
  });

  afterEach(async () => {
    axios.defaults.adapter = originalAdapter;
    await seedCache(undefined);
  });

  it('returns synchronously without awaiting the API', async () => {
    adapter.mockReturnValue(new Promise(() => {}));

    expect(recordSearchHistory('foo')).toBeUndefined();
    await flush();
    expect(adapter).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'post',
        url: '/_api/v3/search-history',
      }),
    );
    expect(requestedKeywords()).toEqual(['foo']);
  });

  it('does not reject or throw when the API fails', async () => {
    adapter.mockRejectedValue(new Error('network down'));
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
    adapter.mockRejectedValue(new Error('boom'));

    recordSearchHistory('foo');
    await flush();

    expect(toastError).not.toHaveBeenCalled();
  });

  it('leaves the cache untouched when the API fails', async () => {
    const cached = [history('a', 'alpha')];
    await seedCache(cached);
    adapter.mockRejectedValue(new Error('boom'));

    recordSearchHistory('foo');
    await flush();

    expect(await readCache()).toEqual(cached);
  });

  it('puts the recorded history at the top of the cached list', async () => {
    await seedCache([history('a', 'alpha'), history('b', 'beta')]);
    respondWith(history('c', 'gamma'));

    recordSearchHistory('gamma');
    await flush();

    expect(await readCache()).toEqual([
      history('c', 'gamma'),
      history('a', 'alpha'),
      history('b', 'beta'),
    ]);
  });

  it('keeps a keyword shaped like an ISO date as a string in the cached list', async () => {
    const keyword = '2024-10-30T00:00:00Z';
    await seedCache([history('a', 'alpha')]);
    respondWith(history('c', keyword));

    recordSearchHistory(keyword);
    await flush();

    expect(await readCache()).toEqual([
      history('c', keyword),
      history('a', 'alpha'),
    ]);
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
