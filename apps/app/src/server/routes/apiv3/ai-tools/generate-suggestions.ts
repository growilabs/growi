import type { IUserHasId } from '@growi/core/dist/interfaces';

import loggerFactory from '~/utils/logger';

import { generateCategorySuggestion } from './generate-category-suggestion';
import { generateMemoSuggestion } from './generate-memo-suggestion';
import type { SearchService } from './generate-search-suggestion';
import { generateSearchSuggestion } from './generate-search-suggestion';
import type { PathSuggestion } from './suggest-path-types';

const logger = loggerFactory(
  'growi:routes:apiv3:ai-tools:generate-suggestions',
);

// Accept unknown for searchService to bridge between the real SearchService class
// (which returns ISearchResult<unknown>) and the local SearchService interface
// (which expects SearchResultItem[]). The cast is safe because Elasticsearch results
// always contain _score and _source.path fields.
export type GenerateSuggestionsDeps = {
  searchService: unknown;
  extractKeywords: (body: string) => Promise<string[]>;
};

export const generateSuggestions = async (
  user: IUserHasId,
  body: string,
  userGroups: unknown,
  deps: GenerateSuggestionsDeps,
): Promise<PathSuggestion[]> => {
  const memoSuggestion = await generateMemoSuggestion(user);

  try {
    const keywords = await deps.extractKeywords(body);

    if (keywords.length === 0) {
      return [memoSuggestion];
    }

    const searchService = deps.searchService as SearchService;
    const [searchSuggestion, categorySuggestion] = await Promise.all([
      generateSearchSuggestion(keywords, user, userGroups, searchService),
      generateCategorySuggestion(keywords, user, userGroups, searchService),
    ]);

    const suggestions: PathSuggestion[] = [memoSuggestion];
    if (searchSuggestion != null) {
      suggestions.push(searchSuggestion);
    }
    if (categorySuggestion != null) {
      suggestions.push(categorySuggestion);
    }

    return suggestions;
  } catch (err) {
    logger.error(
      'Phase 2 suggestion generation failed, falling back to memo only:',
      err,
    );
    return [memoSuggestion];
  }
};
