import { pathUtils } from '@growi/core/dist/utils';

import type { PathSuggestion } from '../../../interfaces/suggest-path-types';
import { SuggestionType } from '../../../interfaces/suggest-path-types';
import { resolveParentGrant } from '../resolve-parent-grant';
import type { AgenticEngineOutput } from './agentic-output-schema';
import { SUGGESTION_CAP } from './agentic-output-schema';

/**
 * Normalize a proposed path to a "/segment/.../" parent-directory form
 * (leading and trailing slash guaranteed). Returns null when nothing
 * remains after trimming — such entries are discarded (design.md
 * AgenticEngine output-mapping rule 2).
 */
const normalizeSuggestionPath = (rawPath: string): string | null => {
  const trimmed = rawPath.trim();
  if (trimmed === '') {
    return null;
  }
  return pathUtils.addTrailingSlash(pathUtils.addHeadingSlash(trimmed));
};

type NormalizedSuggestion = {
  readonly path: string;
  readonly label: string;
  readonly description: string;
};

/**
 * Output-mapping rules 2-4 (design.md AgenticEngine): normalize each path
 * (discarding entries that cannot be normalized), de-duplicate by
 * normalized path keeping the first occurrence, then cap the list — the
 * schema's maxItems is advisory for the model, so the adapter enforces
 * the cap itself.
 */
const toNormalizedSuggestions = (
  output: AgenticEngineOutput,
): NormalizedSuggestion[] => {
  const seenPaths = new Set<string>();
  const normalized: NormalizedSuggestion[] = [];

  for (const suggestion of output.suggestions) {
    const path = normalizeSuggestionPath(suggestion.path);
    if (path == null || seenPaths.has(path)) {
      continue;
    }
    seenPaths.add(path);
    normalized.push({
      path,
      label: suggestion.label,
      description: suggestion.description,
    });
  }

  return normalized.slice(0, SUGGESTION_CAP);
};

/**
 * Map the validated agent output to API suggestions: normalize / de-dup /
 * cap, then resolve the grant for each surviving path in parallel
 * (output-mapping rule 4). A grant resolution failure rejects the whole
 * mapping via Promise.all — matching the oneshot evaluate-pipeline
 * semantics, where one grant failure fails the whole search-suggestion
 * branch; the orchestrator's memo fallback absorbs the rejection
 * (Requirement 4.5).
 */
export const mapOutputToSuggestions = async (
  output: AgenticEngineOutput,
): Promise<PathSuggestion[]> => {
  const normalized = toNormalizedSuggestions(output);

  return Promise.all(
    normalized.map(async (suggestion): Promise<PathSuggestion> => {
      const grant = await resolveParentGrant(suggestion.path);
      return {
        type: SuggestionType.SEARCH,
        path: suggestion.path,
        label: suggestion.label,
        description: suggestion.description,
        grant,
        informationType: output.informationType,
      };
    }),
  );
};
