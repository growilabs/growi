import loggerFactory from '~/utils/logger';

import type {
  ContentAnalysis,
  PathSuggestion,
  SearchCandidate,
} from '../../../interfaces/suggest-path-types';
import { SuggestionType } from '../../../interfaces/suggest-path-types';
import { analyzeContent } from '../analyze-content';
import { evaluateCandidates } from '../evaluate-candidates';
import { generateCategorySuggestion } from '../generate-category-suggestion';
import { resolveParentGrant } from '../resolve-parent-grant';
import { retrieveSearchCandidates } from '../retrieve-search-candidates';
import type { SuggestPathEngine } from './engine-types';

const logger = loggerFactory('growi:ai-tools:suggest-path:oneshot-engine');

/**
 * Oneshot engine: the pre-existing single-pass suggestion pipeline
 * (content analysis -> candidate retrieval -> parallel [evaluation + grant
 * resolution, category generation]), moved verbatim from generateSuggestions.
 *
 * Degradation contract: when analysis or retrieval fails, return an empty
 * array — the orchestrator supplies the memo fallback, so the final API
 * response is identical to the pre-move behavior.
 */
export const oneshotEngine: SuggestPathEngine = async (
  input,
): Promise<PathSuggestion[]> => {
  const { user, body, userGroups, searchService } = input;

  // 1st AI call: Content analysis (keyword extraction + flow/stock classification)
  let analysis: ContentAnalysis;
  try {
    analysis = await analyzeContent(body);
  } catch (err) {
    logger.error('Content analysis failed, degrading to no suggestions:', err);
    return [];
  }

  // Retrieve search candidates (single ES query, shared by evaluate and category)
  let candidates: SearchCandidate[];
  try {
    candidates = await retrieveSearchCandidates(
      analysis.keywords,
      user,
      userGroups,
      searchService,
    );
  } catch (err) {
    logger.error(
      'Search candidate retrieval failed, degrading to no suggestions:',
      err,
    );
    return [];
  }

  // Run evaluate pipeline and category generation in parallel
  const [evaluateResult, categoryResult] = await Promise.allSettled([
    // Evaluate pipeline: evaluate → grant resolution (skip if no candidates)
    candidates.length > 0
      ? (async (): Promise<PathSuggestion[]> => {
          const evaluated = await evaluateCandidates(
            body,
            analysis,
            candidates,
          );
          return Promise.all(
            evaluated.map(async (s): Promise<PathSuggestion> => {
              const grant = await resolveParentGrant(s.path);
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
    generateCategorySuggestion(candidates),
  ]);

  const suggestions: PathSuggestion[] = [];

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
