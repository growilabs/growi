import type { IUserHasId } from '@growi/core/dist/interfaces';

import type { SearchService } from './generate-search-suggestion';
import { resolveParentGrant } from './resolve-parent-grant';
import type { PathSuggestion } from './suggest-path-types';
import { SuggestionType } from './suggest-path-types';

const CATEGORY_LABEL = 'Save under category';
const SEARCH_RESULT_LIMIT = 10;

export function extractTopLevelSegment(pagePath: string): string {
  const segments = pagePath.split('/').filter(Boolean);
  if (segments.length === 0) {
    return '/';
  }
  return `/${segments[0]}/`;
}

export function generateCategoryDescription(topLevelSegment: string): string {
  return `Top-level category: ${topLevelSegment}`;
}

export const generateCategorySuggestion = async (
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
  const topLevelPath = extractTopLevelSegment(topResult._source.path);

  // Extract segment name (strip leading/trailing slashes)
  const segmentName = topLevelPath.replace(/^\/|\/$/g, '');
  if (segmentName === '') {
    return null;
  }

  const description = generateCategoryDescription(segmentName);
  const grant = await resolveParentGrant(topLevelPath);

  return {
    type: SuggestionType.CATEGORY,
    path: topLevelPath,
    label: CATEGORY_LABEL,
    description,
    grant,
  };
};
