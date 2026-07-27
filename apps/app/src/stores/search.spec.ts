import type { IPageHasId } from '@growi/core';
import { mock } from 'vitest-mock-extended';

import type {
  IFormattedSearchResult,
  IPageWithSearchMeta,
} from '~/interfaces/search';
import { SORT_AXIS, SORT_ORDER } from '~/interfaces/search';

import { getSearchInfiniteKey } from './search';

const createResultWithDataCount = (count: number): IFormattedSearchResult => ({
  data: Array.from(
    { length: count },
    (_, i): IPageWithSearchMeta => ({
      data: mock<IPageHasId>({ _id: `page-${i}` }),
    }),
  ),
  meta: { total: 100, hitsCount: count },
});

// Minimal fixed configuration (offset/limit are excluded from the key contract)
const configurations = {
  sort: SORT_AXIS.RELATION_SCORE,
  order: SORT_ORDER.DESC,
  includeTrashPages: false,
  includeUserPages: false,
};

const CHUNK_SIZE = 20;

describe('getSearchInfiniteKey', () => {
  describe('when the keyword is empty', () => {
    it('returns null for a null keyword (fetch disabled)', () => {
      const key = getSearchInfiniteKey(
        0,
        null,
        null,
        CHUNK_SIZE,
        configurations,
      );
      expect(key).toBeNull();
    });

    it('returns null for an empty-string keyword (fetch disabled)', () => {
      const key = getSearchInfiniteKey(0, null, '', CHUNK_SIZE, configurations);
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
        CHUNK_SIZE,
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
        CHUNK_SIZE,
        configurations,
      );
      expect(key).not.toBeNull();
    });
  });

  describe('when fetching a valid page', () => {
    it('uses the "/search/infinite" namespace as the key head', () => {
      const key = getSearchInfiniteKey(
        0,
        null,
        'growi',
        CHUNK_SIZE,
        configurations,
      );
      expect(key?.[0]).toBe('/search/infinite');
    });

    it('carries the keyword and configurations in the key', () => {
      const key = getSearchInfiniteKey(
        0,
        null,
        'growi',
        CHUNK_SIZE,
        configurations,
      );
      expect(key?.[1]).toBe('growi');
      expect(key?.[3]).toEqual(configurations);
    });

    it('computes offset as pageIndex * chunkSize', () => {
      const firstKey = getSearchInfiniteKey(
        0,
        null,
        'growi',
        CHUNK_SIZE,
        configurations,
      );
      expect(firstKey?.[2]).toBe(0);

      const previousPageData = createResultWithDataCount(CHUNK_SIZE);
      const thirdKey = getSearchInfiniteKey(
        2,
        previousPageData,
        'growi',
        CHUNK_SIZE,
        configurations,
      );
      expect(thirdKey?.[2]).toBe(2 * CHUNK_SIZE);
    });
  });
});
