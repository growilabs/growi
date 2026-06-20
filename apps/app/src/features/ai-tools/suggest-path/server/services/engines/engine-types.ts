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
