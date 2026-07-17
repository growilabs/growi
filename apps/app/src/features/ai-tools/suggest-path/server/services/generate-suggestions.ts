import type { IUserHasId } from '@growi/core/dist/interfaces';

import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';
import loggerFactory from '~/utils/logger';

import type {
  PathSuggestion,
  SearchService,
} from '../../interfaces/suggest-path-types';
import { selectEngine } from './engines';
import { generateMemoSuggestion } from './generate-memo-suggestion';

const logger = loggerFactory(
  'growi:features:suggest-path:generate-suggestions',
);

/**
 * Orchestrator: always generates the memo suggestion first, dispatches to
 * the engine selected by runtime availability (agentic when the Mastra AI
 * stack is configured, oneshot when only full-text search is usable,
 * memo-only when neither is available), and applies the asymmetric fallback
 * policy.
 *
 * The one-shot pipeline itself lives in `engines/oneshot-engine.ts`.
 */
export const generateSuggestions = async (
  user: IUserHasId,
  body: string,
  userGroups: ObjectIdLike[],
  searchService: SearchService,
): Promise<PathSuggestion[]> => {
  const memoSuggestion = await generateMemoSuggestion(user);

  // Availability is evaluated per request so a configuration change takes
  // effect without a server restart.
  const engineRecord = selectEngine(searchService);
  if (engineRecord == null) {
    logger.info(
      'No suggest-path engine is available (Mastra AI is not configured and full-text search is not reachable); returning the memo suggestion only',
    );
    return [memoSuggestion];
  }

  const input = { user, body, userGroups, searchService };

  // Asymmetric fallback policy (Requirements 4.5, 5.2), declared by each
  // engine record: engines with degradeToMemoOnFailure absorb their
  // rejections (exceptions, timeouts) into a memo-only response, the others
  // keep the pre-existing contract and propagate to the route (HTTP 500).
  if (engineRecord.degradeToMemoOnFailure) {
    try {
      const engineSuggestions = await engineRecord.run(input);
      return [memoSuggestion, ...engineSuggestions];
    } catch (err) {
      logger.error(
        `Suggest-path engine "${engineRecord.id}" failed, falling back to memo only:`,
        err,
      );
      return [memoSuggestion];
    }
  }

  const engineSuggestions = await engineRecord.run(input);
  return [memoSuggestion, ...engineSuggestions];
};
