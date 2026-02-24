import type { IUserHasId } from '@growi/core/dist/interfaces';

import loggerFactory from '~/utils/logger';

import { generateMemoSuggestion } from './generate-memo-suggestion';
import type {
  ContentAnalysis,
  EvaluatedSuggestion,
  PathSuggestion,
  SearchCandidate,
} from './suggest-path-types';
import { SuggestionType } from './suggest-path-types';

const logger = loggerFactory(
  'growi:routes:apiv3:ai-tools:generate-suggestions',
);

export type GenerateSuggestionsDeps = {
  analyzeContent: (body: string) => Promise<ContentAnalysis>;
  retrieveSearchCandidates: (
    keywords: string[],
    user: IUserHasId,
    userGroups: unknown,
  ) => Promise<SearchCandidate[]>;
  evaluateCandidates: (
    body: string,
    analysis: ContentAnalysis,
    candidates: SearchCandidate[],
  ) => Promise<EvaluatedSuggestion[]>;
  generateCategorySuggestion: (
    keywords: string[],
    user: IUserHasId,
    userGroups: unknown,
  ) => Promise<PathSuggestion | null>;
  resolveParentGrant: (path: string) => Promise<number>;
};

export const generateSuggestions = async (
  user: IUserHasId,
  body: string,
  userGroups: unknown,
  deps: GenerateSuggestionsDeps,
): Promise<PathSuggestion[]> => {
  const memoSuggestion = await generateMemoSuggestion(user);

  // 1st AI call: Content analysis (keyword extraction + flow/stock classification)
  let analysis: ContentAnalysis;
  try {
    analysis = await deps.analyzeContent(body);
  } catch (err) {
    logger.error('Content analysis failed, falling back to memo only:', err);
    return [memoSuggestion];
  }

  if (analysis.keywords.length === 0) {
    return [memoSuggestion];
  }

  // Run search-evaluate pipeline and category generation in parallel
  const [searchResult, categoryResult] = await Promise.allSettled([
    // Search-evaluate pipeline: search → evaluate → grant resolution
    (async (): Promise<PathSuggestion[]> => {
      const candidates = await deps.retrieveSearchCandidates(
        analysis.keywords,
        user,
        userGroups,
      );
      if (candidates.length === 0) {
        return [];
      }
      const evaluated = await deps.evaluateCandidates(
        body,
        analysis,
        candidates,
      );
      return Promise.all(
        evaluated.map(async (s): Promise<PathSuggestion> => {
          const grant = await deps.resolveParentGrant(s.path);
          return {
            type: SuggestionType.SEARCH,
            path: s.path,
            label: s.label,
            description: s.description,
            grant,
            informationType: analysis.informationType,
          };
        }),
      );
    })(),
    // Category generation (parallel, independent)
    deps.generateCategorySuggestion(analysis.keywords, user, userGroups),
  ]);

  const suggestions: PathSuggestion[] = [memoSuggestion];

  if (searchResult.status === 'fulfilled') {
    suggestions.push(...searchResult.value);
  } else {
    logger.error('Search-evaluate pipeline failed:', searchResult.reason);
  }

  if (categoryResult.status === 'fulfilled' && categoryResult.value != null) {
    suggestions.push(categoryResult.value);
  } else if (categoryResult.status === 'rejected') {
    logger.error('Category generation failed:', categoryResult.reason);
  }

  return suggestions;
};
