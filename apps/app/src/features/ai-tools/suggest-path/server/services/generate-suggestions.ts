import type { IUserHasId } from '@growi/core/dist/interfaces';

import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import type {
  PathSuggestion,
  SearchService,
} from '../../interfaces/suggest-path-types';
import { SuggestPathEngineId } from '../../interfaces/suggest-path-types';
import { runEngine } from './engines';
import { generateMemoSuggestion } from './generate-memo-suggestion';

const logger = loggerFactory(
  'growi:features:suggest-path:generate-suggestions',
);

export interface GenerateSuggestionsOptions {
  readonly engine?: SuggestPathEngineId;
}

/**
 * Orchestrator: always generates the memo suggestion first, dispatches to
 * the selected engine (request-specified, else the configured default), and
 * applies the asymmetric fallback policy.
 *
 * The one-shot pipeline itself lives in `engines/oneshot-engine.ts`.
 */
// biome-ignore lint/complexity/useMaxParams: the design mandates a backward-compatible signature (existing positional args + optional options)
export const generateSuggestions = async (
  user: IUserHasId,
  body: string,
  userGroups: ObjectIdLike[],
  searchService: SearchService,
  options?: GenerateSuggestionsOptions,
): Promise<PathSuggestion[]> => {
  const memoSuggestion = await generateMemoSuggestion(user);

  // The configured default is read per request so a config change takes
  // effect without a server restart.
  const engineId =
    options?.engine ?? configManager.getConfig('aiTools:suggestPathEngine');

  const input = { user, body, userGroups, searchService };

  // Asymmetric fallback policy (Requirements 4.5, 5.3): the agentic engine's
  // rejections (exceptions, timeouts) degrade to a memo-only response, while
  // oneshot engine exceptions keep the pre-existing contract and propagate
  // to the route (HTTP 500).
  if (engineId === SuggestPathEngineId.AGENTIC) {
    try {
      const engineSuggestions = await runEngine(engineId, input);
      return [memoSuggestion, ...engineSuggestions];
    } catch (err) {
      logger.error('Agentic engine failed, falling back to memo only:', err);
      return [memoSuggestion];
    }
  }

  const engineSuggestions = await runEngine(engineId, input);
  return [memoSuggestion, ...engineSuggestions];
};
