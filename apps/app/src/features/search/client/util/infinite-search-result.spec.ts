import type { IPageHasId } from '@growi/core';
import { mock } from 'vitest-mock-extended';

import type {
  IFormattedSearchResult,
  IPageWithSearchMeta,
  ISearchResultMeta,
} from '~/interfaces/search';

import { mergeInfiniteSearchResult } from './infinite-search-result';

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
      const result = mergeInfiniteSearchResult(undefined);

      expect(result.pages).toEqual([]);
      expect(result.loadedCount).toBe(0);
      expect(result.total).toBe(0);
      expect(result.took).toBeUndefined();
      expect(result.isEmpty).toBe(false);
      expect(result.isReachingEnd).toBe(false);
    });
  });

  describe('when the total has not been reached (should keep loading)', () => {
    it('flattens accumulated pages and does not signal the end', () => {
      const page1 = createPage('page-1');
      const page2 = createPage('page-2');
      const page3 = createPage('page-3');
      const data = [
        createFormattedResult([page1, page2], {
          total: 5,
          hitsCount: 2,
          took: 3,
        }),
        createFormattedResult([page3], { total: 5, hitsCount: 1 }),
      ];

      const result = mergeInfiniteSearchResult(data);

      // pages are the flatMap of each chunk's data, in order
      expect(result.pages).toEqual([page1, page2, page3]);
      expect(result.loadedCount).toBe(3);
      expect(result.total).toBe(5);
      // took comes from the first chunk's meta
      expect(result.took).toBe(3);
      expect(result.isEmpty).toBe(false);
      // 3 < 5 => keep loading
      expect(result.isReachingEnd).toBe(false);
    });
  });

  describe('when the loaded count reaches the total (should stop)', () => {
    it('signals the end once the accumulated count equals the total', () => {
      const pages = [createPage('page-1'), createPage('page-2')];
      const data = [
        createFormattedResult(pages, { total: 2, hitsCount: 2, took: 1 }),
      ];

      const result = mergeInfiniteSearchResult(data);

      expect(result.loadedCount).toBe(2);
      expect(result.total).toBe(2);
      expect(result.isEmpty).toBe(false);
      // 2 >= 2 => reaching end
      expect(result.isReachingEnd).toBe(true);
    });
  });

  describe('when there are zero hits', () => {
    it('marks the result as empty and terminal', () => {
      const data = [
        createFormattedResult([], { total: 0, hitsCount: 0, took: 1 }),
      ];

      const result = mergeInfiniteSearchResult(data);

      expect(result.pages).toEqual([]);
      expect(result.loadedCount).toBe(0);
      expect(result.total).toBe(0);
      expect(result.isEmpty).toBe(true);
      // 0 >= 0 => reaching end (no further loading)
      expect(result.isReachingEnd).toBe(true);
    });
  });
});
