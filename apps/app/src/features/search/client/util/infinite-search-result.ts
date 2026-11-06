import type {
  IFormattedSearchResult,
  IPageWithSearchMeta,
} from '~/interfaces/search';

export type MergedSearchResult = {
  pages: IPageWithSearchMeta[];
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
  chunkSize: number,
): MergedSearchResult => {
  if (data == null) {
    return {
      pages: [],
      total: 0,
      isEmpty: false,
      isReachingEnd: false,
    };
  }

  const pages = data.flatMap((result) => result.data);
  const total = data[0]?.meta.total ?? 0;
  const took = data[0]?.meta.took;

  // Number of results Elasticsearch actually returned across all fetched chunks,
  // counted BEFORE the server drops pages missing from MongoDB. End-of-results
  // must be judged by this pre-filter count: `pages.length` (post-filter) can
  // stay below `total` forever when the ES index has drifted, which would
  // otherwise keep `isReachingEnd` false and spin the loader indefinitely.
  // (Do not reintroduce a post-filter count field for this purpose — A-6.)
  const fetchedCount = data.reduce(
    (acc, result) => acc + result.meta.hitsCount,
    0,
  );

  // A chunk that returned fewer hits than requested means Elasticsearch has no
  // more results, regardless of `total` (which can over-count with
  // track_total_hits or concurrent deletions). This mirrors
  // getSearchInfiniteKey's stop condition, so the two never disagree and leave
  // the loader spinning after the fetch has already stopped.
  const lastChunk = data[data.length - 1];
  const lastChunkPartial =
    lastChunk != null && lastChunk.meta.hitsCount < chunkSize;

  return {
    pages,
    total,
    took,
    isEmpty: total === 0,
    isReachingEnd: fetchedCount >= total || lastChunkPartial,
  };
};
