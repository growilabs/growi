import type { IUserHasId } from '@growi/core/dist/interfaces';
import { RequestContext } from '@mastra/core/request-context';

import type { SuggestPathRequestContextShape } from '~/features/mastra/server/services/mastra-modules/agents/suggest-path';
import type SearchServiceImpl from '~/server/service/search';

import type { SearchService } from '../../../interfaces/suggest-path-types';

export interface AgenticBudgetLimits {
  readonly searchLimit: number;
  readonly childListingLimit: number;
}

/**
 * The per-request context bundle handed to the agent loop. The budgets are
 * returned alongside the context because they stay the engine's primary
 * trace source (searchCount, executed-query sequence) after the loop ran.
 */
export interface AgenticRequestContextBundle {
  readonly requestContext: RequestContext<SuggestPathRequestContextShape>;
  readonly searchBudget: SuggestPathRequestContextShape['searchBudget'];
  readonly childListingBudget: SuggestPathRequestContextShape['childListingBudget'];
}

/**
 * Build the request context for one agentic run. MUST be called per request
 * — a module-scope instance would leak `user` (and the budgets) across
 * concurrent requests.
 */
export const buildAgenticRequestContext = (
  user: IUserHasId,
  searchService: SearchService,
  limits: AgenticBudgetLimits,
): AgenticRequestContextBundle => {
  const requestContext = new RequestContext<SuggestPathRequestContextShape>();
  requestContext.set('user', user);
  // The engine input carries the narrow engine-facing view of the search
  // service (suggest-path-types SearchService); at runtime it is the full
  // ~/server/service/search instance, which the route narrowed the same way
  // in reverse. Widen it back here at the mastra platform boundary.
  requestContext.set(
    'searchService',
    searchService as unknown as SearchServiceImpl,
  );
  const searchBudget: SuggestPathRequestContextShape['searchBudget'] = {
    limit: limits.searchLimit,
    used: 0,
    queries: [],
  };
  requestContext.set('searchBudget', searchBudget);
  // Independent of the search budget: listChildren runs a light Mongo path
  // query (no Elasticsearch), so peer-verification drill-ins draw from this
  // pool, not from the ES search pool.
  const childListingBudget: SuggestPathRequestContextShape['childListingBudget'] =
    {
      limit: limits.childListingLimit,
      used: 0,
      paths: [],
    };
  requestContext.set('childListingBudget', childListingBudget);

  return { requestContext, searchBudget, childListingBudget };
};
