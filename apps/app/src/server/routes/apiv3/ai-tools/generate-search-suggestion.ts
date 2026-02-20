import type { IUserHasId } from '@growi/core/dist/interfaces';

import { resolveParentGrant } from './resolve-parent-grant';
import type { PathSuggestion } from './suggest-path-types';
import { SuggestionType } from './suggest-path-types';

const SEARCH_LABEL = 'Save near related pages';
const SEARCH_RESULT_LIMIT = 10;
const MAX_DESCRIPTION_TITLES = 3;

type SearchResultItem = {
  _score: number;
  _source: {
    path: string;
  };
};

export type SearchService = {
  searchKeyword(
    keyword: string,
    nqName: string | null,
    user: IUserHasId,
    userGroups: unknown,
    opts: Record<string, unknown>,
  ): Promise<[{ data: SearchResultItem[] }, unknown]>;
};

export function extractParentDirectory(pagePath: string): string {
  const segments = pagePath.split('/').filter(Boolean);
  if (segments.length <= 1) {
    return '/';
  }
  segments.pop();
  return `/${segments.join('/')}/`;
}

export function extractPageTitle(pagePath: string): string {
  const segments = pagePath.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? '';
}

export function generateSearchDescription(pageTitles: string[]): string {
  if (pageTitles.length === 0) {
    return '';
  }
  return `Related pages under this directory: ${pageTitles.join(', ')}`;
}

export const generateSearchSuggestion = async (
  keywords: string[],
  user: IUserHasId,
  userGroups: unknown,
  searchService: SearchService,
): Promise<PathSuggestion | null> => {
  const keyword = keywords.join(' ');

  const [searchResult] = await searchService.searchKeyword(
    keyword,
    null,
    user,
    userGroups,
    { limit: SEARCH_RESULT_LIMIT },
  );

  const results = searchResult.data;
  if (results.length === 0) {
    return null;
  }

  const topResult = results[0];
  const parentDir = extractParentDirectory(topResult._source.path);

  // Filter to pages under the parent directory and extract titles
  const titles = results
    .filter((r) => r._source.path.startsWith(parentDir))
    .slice(0, MAX_DESCRIPTION_TITLES)
    .map((r) => extractPageTitle(r._source.path))
    .filter(Boolean);

  const description = generateSearchDescription(titles);
  const grant = await resolveParentGrant(parentDir);

  return {
    type: SuggestionType.SEARCH,
    path: parentDir,
    label: SEARCH_LABEL,
    description,
    grant,
  };
};
