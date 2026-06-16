import type {
  PathSuggestion,
  SearchCandidate,
} from '../../interfaces/suggest-path-types';
import { SuggestionType } from '../../interfaces/suggest-path-types';
import { resolveParentGrant } from './resolve-parent-grant';

const CATEGORY_LABEL = 'Save under category';

export function extractTopLevelSegmentName(pagePath: string): string | null {
  const segments = pagePath.split('/').filter(Boolean);
  return segments[0] ?? null;
}

export const generateCategorySuggestion = async (
  candidates: SearchCandidate[],
): Promise<PathSuggestion | null> => {
  if (candidates.length === 0) {
    return null;
  }

  const segmentName = extractTopLevelSegmentName(candidates[0].pagePath);
  if (segmentName == null) {
    return null;
  }

  const topLevelPath = `/${segmentName}/`;
  const grant = await resolveParentGrant(topLevelPath);

  return {
    type: SuggestionType.CATEGORY,
    path: topLevelPath,
    label: CATEGORY_LABEL,
    description: `Top-level category: ${segmentName}`,
    grant,
  };
};
