import type { IUserHasId } from '@growi/core/dist/interfaces';

import loggerFactory from '~/utils/logger';

import type {
  ContentAnalysis,
  EvaluatedSuggestion,
  PathSuggestion,
  SearchCandidate,
} from '../../interfaces/suggest-path-types';
import { SuggestionType } from '../../interfaces/suggest-path-types';
import { generateMemoSuggestion } from './generate-memo-suggestion';

const logger = loggerFactory(
  'growi:features:suggest-path:generate-suggestions',
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
    candidates: SearchCandidate[],
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

  // Retrieve search candidates (single ES query, shared by evaluate and category)
  let candidates: SearchCandidate[];
  try {
    candidates = await deps.retrieveSearchCandidates(
      analysis.keywords,
      user,
      userGroups,
    );
  } catch (err) {
    logger.error(
      'Search candidate retrieval failed, falling back to memo only:',
      err,
    );
    return [memoSuggestion];
  }

  // Run evaluate pipeline and category generation in parallel
  const [evaluateResult, categoryResult] = await Promise.allSettled([
    // Evaluate pipeline: evaluate → grant resolution (skip if no candidates)
    candidates.length > 0
      ? (async (): Promise<PathSuggestion[]> => {
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
        })()
      : Promise.resolve([]),
    // Category generation (uses same candidates, no extra ES query)
    deps.generateCategorySuggestion(candidates),
  ]);

  const suggestions: PathSuggestion[] = [memoSuggestion];

  if (evaluateResult.status === 'fulfilled') {
    suggestions.push(...evaluateResult.value);
  } else {
    logger.error('Evaluate pipeline failed:', evaluateResult.reason);
  }

  if (categoryResult.status === 'fulfilled' && categoryResult.value != null) {
    suggestions.push(categoryResult.value);
  } else if (categoryResult.status === 'rejected') {
    logger.error('Category generation failed:', categoryResult.reason);
  }

  return suggestions;
};
