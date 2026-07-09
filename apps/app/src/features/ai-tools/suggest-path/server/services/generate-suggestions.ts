import type { IUserHasId } from '@growi/core/dist/interfaces';

import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import type {
  PathSuggestion,
  SearchService,
  SuggestPathEngineId,
} from '../../interfaces/suggest-path-types';
import { getEngineRecord } from './engines';
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

  // The env-sourced config value is not runtime-validated by the config
  // layer, so an operator typo (e.g. 'onshot') reaches this point. An unknown
  // id degrades to the guaranteed memo-only response instead of crashing the
  // request with an HTTP 500 (request-supplied ids are already rejected by
  // the route validator).
  const engineRecord = getEngineRecord(engineId);
  if (engineRecord == null) {
    logger.error(
      `Unknown suggest-path engine "${engineId}" (check aiTools:suggestPathEngine / AI_TOOLS_SUGGEST_PATH_ENGINE); falling back to memo only`,
    );
    return [memoSuggestion];
  }

  const input = { user, body, userGroups, searchService };

  // Asymmetric fallback policy (Requirements 4.5, 5.3), declared by each
  // engine record: engines with degradeToMemoOnFailure absorb their
  // rejections (exceptions, timeouts) into a memo-only response, the others
  // keep the pre-existing contract and propagate to the route (HTTP 500).
  if (engineRecord.degradeToMemoOnFailure) {
    try {
      const engineSuggestions = await engineRecord.run(input);
      return [memoSuggestion, ...engineSuggestions];
    } catch (err) {
      logger.error(
        `Suggest-path engine "${engineId}" failed, falling back to memo only:`,
        err,
      );
      return [memoSuggestion];
    }
  }

  const engineSuggestions = await engineRecord.run(input);
  return [memoSuggestion, ...engineSuggestions];
};
