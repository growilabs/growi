import type { IPageHasId } from '@growi/core';
import { mutate as swrMutate } from 'swr';
import { mock } from 'vitest-mock-extended';

import type {
  IFormattedSearchResult,
  IPageWithSearchMeta,
} from '~/interfaces/search';
import { SORT_AXIS, SORT_ORDER } from '~/interfaces/search';

import { getSearchInfiniteKey, mutateSearching } from './search';

vi.mock('swr', () => ({
  default: vi.fn(),
  mutate: vi.fn(),
}));

const CHUNK_SIZE = 20;

const createResultWithDataCount = (count: number): IFormattedSearchResult => ({
  data: Array.from(
    { length: count },
    (_, i): IPageWithSearchMeta => ({
      data: mock<IPageHasId>({ _id: `page-${i}` }),
    }),
  ),
  meta: { total: 100, hitsCount: count },
});

// Decouples the returned data length (post-MongoDB-filter) from hitsCount
// (the raw count Elasticsearch returned) to model index drift.
const createDriftedResult = (
  dataCount: number,
  hitsCount: number,
): IFormattedSearchResult => ({
  data: Array.from(
    { length: dataCount },
    (_, i): IPageWithSearchMeta => ({
      data: mock<IPageHasId>({ _id: `page-${i}` }),
    }),
  ),
  meta: { total: 100, hitsCount },
});

// Fixed configuration carried in the key. `limit` (= chunk size) and `nqName`
// are part of it; only `offset` is derived per page and excluded.
const configurations = {
  limit: CHUNK_SIZE,
  sort: SORT_AXIS.RELATION_SCORE,
  order: SORT_ORDER.DESC,
  includeTrashPages: false,
  includeUserPages: false,
  nqName: null,
};

describe('getSearchInfiniteKey', () => {
  describe('when the keyword is empty', () => {
    it('returns null for a null keyword (fetch disabled)', () => {
      const key = getSearchInfiniteKey(0, null, null, configurations);
      expect(key).toBeNull();
    });

    it('returns null for an empty-string keyword (fetch disabled)', () => {
      const key = getSearchInfiniteKey(0, null, '', configurations);
      expect(key).toBeNull();
    });
  });

  describe('when the previous page is the last one', () => {
    it('returns null when the previous page returned fewer items than the chunk size', () => {
      const previousPageData = createResultWithDataCount(CHUNK_SIZE - 1);
      const key = getSearchInfiniteKey(
        1,
        previousPageData,
        'growi',
        configurations,
      );
      expect(key).toBeNull();
    });

    it('continues (returns a key) when the previous page filled the chunk exactly', () => {
      const previousPageData = createResultWithDataCount(CHUNK_SIZE);
      const key = getSearchInfiniteKey(
        1,
        previousPageData,
        'growi',
        configurations,
      );
      expect(key).not.toBeNull();
    });
  });

  describe('when the ES index has drifted (server dropped pages)', () => {
    it('continues when data.length < chunkSize but hitsCount is a full chunk', () => {
      // ES returned a full chunk (hitsCount === CHUNK_SIZE) but the server
      // dropped 3 pages missing from MongoDB, so data.length is below the chunk.
      const previousPageData = createDriftedResult(CHUNK_SIZE - 3, CHUNK_SIZE);
      const key = getSearchInfiniteKey(
        1,
        previousPageData,
        'growi',
        configurations,
      );
      // The old `data.length < chunkSize` check would stop here (null) and
      // truncate the results. The hitsCount-based check keeps going.
      expect(key).not.toBeNull();
    });

    it('stops when hitsCount itself is below the chunk size (true end)', () => {
      const previousPageData = createDriftedResult(
        CHUNK_SIZE - 3,
        CHUNK_SIZE - 1,
      );
      const key = getSearchInfiniteKey(
        1,
        previousPageData,
        'growi',
        configurations,
      );
      expect(key).toBeNull();
    });
  });

  describe('when fetching a valid page', () => {
    it('uses the "/search/infinite" namespace as the key head', () => {
      const key = getSearchInfiniteKey(0, null, 'growi', configurations);
      expect(key?.[0]).toBe('/search/infinite');
    });

    it('carries the keyword and configurations (incl. limit and nqName) in the key', () => {
      const key = getSearchInfiniteKey(0, null, 'growi', configurations);
      expect(key?.[1]).toBe('growi');
      expect(key?.[3]).toEqual(configurations);
      // limit and nqName must be part of the key so different values never
      // share a cache entry.
      expect(key?.[3].limit).toBe(CHUNK_SIZE);
      expect(key?.[3].nqName).toBeNull();
    });

    it('computes offset as pageIndex * chunkSize', () => {
      const firstKey = getSearchInfiniteKey(0, null, 'growi', configurations);
      expect(firstKey?.[2]).toBe(0);

      const previousPageData = createResultWithDataCount(CHUNK_SIZE);
      const thirdKey = getSearchInfiniteKey(
        2,
        previousPageData,
        'growi',
        configurations,
      );
      expect(thirdKey?.[2]).toBe(2 * CHUNK_SIZE);
    });
  });
});

describe('mutateSearching', () => {
  it('revalidates both the paginated and the infinite-scroll caches', async () => {
    await mutateSearching();

    // capture the key-matcher predicate handed to swr's global mutate
    const predicate = vi.mocked(swrMutate).mock.calls.at(-1)?.[0] as (
      key: unknown,
    ) => boolean;

    expect(predicate(['/search', 'growi', {}])).toBe(true);
    expect(predicate(['/search/infinite', 'growi', 0, {}])).toBe(true);
    // unrelated caches and non-array keys must not match
    expect(predicate(['/pages/recent'])).toBe(false);
    expect(predicate('/search')).toBe(false);
  });
});
