import type { IPageHasId } from '@growi/core';
import { mock } from 'vitest-mock-extended';

import type {
  IFormattedSearchResult,
  IPageWithSearchMeta,
  ISearchResultMeta,
} from '~/interfaces/search';

import { mergeInfiniteSearchResult } from './infinite-search-result';

const CHUNK_SIZE = 2;

const createPage = (id: string): IPageWithSearchMeta => ({
  data: mock<IPageHasId>({ _id: id }),
});

const createFormattedResult = (
  pages: IPageWithSearchMeta[],
  meta: ISearchResultMeta,
): IFormattedSearchResult => ({
  data: pages,
  meta,
});

describe('mergeInfiniteSearchResult', () => {
  describe('when data is not yet loaded (undefined)', () => {
    it('returns an empty, non-terminal result', () => {
      const result = mergeInfiniteSearchResult(undefined, CHUNK_SIZE);

      expect(result.pages).toEqual([]);
      expect(result.loadedCount).toBe(0);
      expect(result.total).toBe(0);
      expect(result.took).toBeUndefined();
      expect(result.isEmpty).toBe(false);
      expect(result.isReachingEnd).toBe(false);
    });
  });

  describe('when full chunks are loaded but the total is not reached', () => {
    it('flattens accumulated pages and does not signal the end', () => {
      const page1 = createPage('page-1');
      const page2 = createPage('page-2');
      const page3 = createPage('page-3');
      const page4 = createPage('page-4');
      // both chunks are full (hitsCount === CHUNK_SIZE), 4 of 5 fetched
      const data = [
        createFormattedResult([page1, page2], {
          total: 5,
          hitsCount: 2,
          took: 3,
        }),
        createFormattedResult([page3, page4], { total: 5, hitsCount: 2 }),
      ];

      const result = mergeInfiniteSearchResult(data, CHUNK_SIZE);

      expect(result.pages).toEqual([page1, page2, page3, page4]);
      expect(result.loadedCount).toBe(4);
      expect(result.total).toBe(5);
      // took comes from the first chunk's meta
      expect(result.took).toBe(3);
      expect(result.isEmpty).toBe(false);
      // last chunk was full and 4 < 5 => keep loading
      expect(result.isReachingEnd).toBe(false);
    });
  });

  describe('when the fetched count reaches the total (should stop)', () => {
    it('signals the end once the fetched count equals the total', () => {
      const pages = [createPage('page-1'), createPage('page-2')];
      const data = [
        createFormattedResult(pages, { total: 2, hitsCount: 2, took: 1 }),
      ];

      const result = mergeInfiniteSearchResult(data, CHUNK_SIZE);

      expect(result.loadedCount).toBe(2);
      expect(result.total).toBe(2);
      expect(result.isEmpty).toBe(false);
      // 2 >= 2 => reaching end
      expect(result.isReachingEnd).toBe(true);
    });
  });

  describe('when the ES index has drifted (server dropped pages, chunk still full)', () => {
    it('signals the end from the pre-filter hitsCount, not the post-filter loadedCount', () => {
      // Elasticsearch returned a full chunk (hitsCount 2 === total), but the
      // server dropped one page missing from MongoDB, so `data` holds only 1.
      const data = [
        createFormattedResult([createPage('page-1')], {
          total: 2,
          hitsCount: 2,
          took: 1,
        }),
      ];

      const result = mergeInfiniteSearchResult(data, CHUNK_SIZE);

      // post-filter count is below total ...
      expect(result.loadedCount).toBe(1);
      expect(result.total).toBe(2);
      // ... but hitsCount reached total, so we must stop. The old
      // `loadedCount >= total` (1 >= 2) would be false and spin forever.
      expect(result.isReachingEnd).toBe(true);
    });
  });

  describe('when Elasticsearch over-counts the total (partial last chunk)', () => {
    it('stops once a chunk returns fewer hits than requested, even if total is higher', () => {
      // ES reports total 100 (e.g. track_total_hits estimate) but the first
      // chunk already returned fewer than the chunk size => no more results.
      const data = [
        createFormattedResult([createPage('page-1')], {
          total: 100,
          hitsCount: 1,
        }),
      ];

      const result = mergeInfiniteSearchResult(data, CHUNK_SIZE);

      expect(result.total).toBe(100);
      // fetchedCount(1) < total(100), but the partial chunk means the fetch has
      // stopped; without this, the loader would spin forever.
      expect(result.isReachingEnd).toBe(true);
    });
  });

  describe('when there are zero hits', () => {
    it('marks the result as empty and terminal', () => {
      const data = [
        createFormattedResult([], { total: 0, hitsCount: 0, took: 1 }),
      ];

      const result = mergeInfiniteSearchResult(data, CHUNK_SIZE);

      expect(result.pages).toEqual([]);
      expect(result.loadedCount).toBe(0);
      expect(result.total).toBe(0);
      expect(result.isEmpty).toBe(true);
      expect(result.isReachingEnd).toBe(true);
    });
  });
});
