import type {
  IFormattedSearchResult,
  IPageWithSearchMeta,
} from '~/interfaces/search';

export type MergedSearchResult = {
  pages: IPageWithSearchMeta[];
  loadedCount: number;
  total: number;
  took?: number;
  isEmpty: boolean;
  isReachingEnd: boolean;
};

/**
 * Derive the accumulated, render-ready search result from the page array
 * returned by useSWRInfinite.
 *
 * The `total` and `took` are taken from the first chunk's meta because
 * `meta.total` is invariant across chunks for the same search condition.
 * When `data` is not yet loaded (`undefined`), an empty and non-terminal
 * result is returned so the caller neither shows "0 hits" nor stops loading.
 */
export const mergeInfiniteSearchResult = (
  data: IFormattedSearchResult[] | undefined,
): MergedSearchResult => {
  if (data == null) {
    return {
      pages: [],
      loadedCount: 0,
      total: 0,
      isEmpty: false,
      isReachingEnd: false,
    };
  }

  const pages = data.flatMap((result) => result.data);
  const loadedCount = pages.length;
  const total = data[0]?.meta.total ?? 0;
  const took = data[0]?.meta.took;

  // Number of results Elasticsearch actually returned across all fetched chunks,
  // counted BEFORE the server drops pages missing from MongoDB. End-of-results
  // must be judged by this pre-filter count: `loadedCount` (post-filter) can stay
  // below `total` forever when the ES index has drifted, which would otherwise
  // keep `isReachingEnd` false and spin the loader indefinitely.
  const fetchedCount = data.reduce(
    (acc, result) => acc + result.meta.hitsCount,
    0,
  );

  return {
    pages,
    loadedCount,
    total,
    took,
    isEmpty: total === 0,
    isReachingEnd: fetchedCount >= total,
  };
};
