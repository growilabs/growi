import type { IUserHasId } from '@growi/core/dist/interfaces';

import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';

import type {
  PathSuggestion,
  SearchService,
} from '../../../interfaces/suggest-path-types';

export interface SuggestPathEngineInput {
  readonly user: IUserHasId;
  readonly body: string;
  readonly userGroups: ObjectIdLike[];
  readonly searchService: SearchService;
}

/**
 * Engine contract: produces only 'search' / 'category' suggestions.
 * The memo suggestion is the orchestrator's responsibility.
 */
export type SuggestPathEngine = (
  input: SuggestPathEngineInput,
) => Promise<PathSuggestion[]>;

/**
 * Engine record: the implementation plus the fallback policy the engine
 * declares for itself. `degradeToMemoOnFailure` = true means the orchestrator
 * absorbs the engine's rejections into a memo-only response; false keeps the
 * propagate-to-route (HTTP 500) contract. `id` identifies the engine in logs.
 */
export interface SuggestPathEngineRecord {
  readonly id: string;
  readonly run: SuggestPathEngine;
  readonly degradeToMemoOnFailure: boolean;
}
