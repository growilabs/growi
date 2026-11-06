import type {
  IFormattedSearchResult,
  IPageWithSearchMeta,
} from '~/interfaces/search';

// A single-row page operation that changes what the accumulated result list
// should show. Duplication is absent on purpose: it never changes an existing
// row, so there is nothing to rewrite.
export type SearchItemMutation =
  | { type: 'renamed'; fromPath: string; toPath: string }
  | { type: 'deleted'; path: string; isRecursively: boolean };

// Match on a trailing '/' so that '/foo' never captures the unrelated '/foobar'.
const isDescendantOf = (path: string, ancestorPath: string): boolean =>
  path.startsWith(`${ancestorPath}/`);

const withPath = (
  page: IPageWithSearchMeta,
  path: string,
): IPageWithSearchMeta => {
  const elasticSearchResult = page.meta?.elasticSearchResult;
  return {
    ...page,
    data: { ...page.data, path },
    // The highlighted path was rendered from the OLD path; PageListItemL prefers
    // it over `data.path`, so drop it or the row would keep showing the old path.
    meta:
      page.meta == null
        ? page.meta
        : {
            ...page.meta,
            elasticSearchResult:
              elasticSearchResult == null
                ? elasticSearchResult
                : { ...elasticSearchResult, highlightedPath: undefined },
          },
  };
};

const renamePage = (
  page: IPageWithSearchMeta,
  fromPath: string,
  toPath: string,
): IPageWithSearchMeta => {
  const { path } = page.data;
  if (path === fromPath) {
    return withPath(page, toPath);
  }
  // Descendants move together with the renamed page.
  if (isDescendantOf(path, fromPath)) {
    return withPath(page, `${toPath}${path.slice(fromPath.length)}`);
  }
  return page;
};

const isDeleted = (
  page: IPageWithSearchMeta,
  path: string,
  isRecursively: boolean,
): boolean =>
  page.data.path === path ||
  (isRecursively && isDescendantOf(page.data.path, path));

/**
 * Apply a single-row page operation to one cached search-result chunk, so the
 * list can be updated in place without re-fetching any chunk.
 *
 * `meta` (total / hitsCount) is left untouched on purpose: `hitsCount` drives
 * end-of-results detection and must keep reflecting what Elasticsearch
 * returned for this chunk's offset.
 */
export const applySearchItemMutation = (
  chunk: IFormattedSearchResult,
  mutation: SearchItemMutation,
): IFormattedSearchResult => {
  switch (mutation.type) {
    case 'renamed':
      return {
        ...chunk,
        data: chunk.data.map((page) =>
          renamePage(page, mutation.fromPath, mutation.toPath),
        ),
      };
    case 'deleted':
      return {
        ...chunk,
        data: chunk.data.filter(
          (page) => !isDeleted(page, mutation.path, mutation.isRecursively),
        ),
      };
  }
};
