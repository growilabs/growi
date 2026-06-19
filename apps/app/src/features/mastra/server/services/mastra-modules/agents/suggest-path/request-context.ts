import type { MastraRequestContextShape } from '../../types/request-context';

/**
 * Per-request search budget propagated through the request context.
 *
 * `used` and `queries` are intentionally mutable: they are per-request
 * accumulation state scoped to a single RequestContext instance and are
 * never shared across request boundaries. The limited search tool
 * increments `used` and records each executed query into `queries`
 * BEFORE delegating, so the trace (Requirement 2.4) and the limit
 * enforcement (Requirement 3.1) stay consistent even when the delegated
 * search fails.
 */
export type SearchBudget = {
  readonly limit: number;
  used: number;
  readonly queries: string[];
};

/**
 * Per-request budget for listChildren — tracked SEPARATELY from the
 * full-text search budget on purpose. listChildren does not touch
 * Elasticsearch (it runs a light grant-aware Mongo path query), so it must
 * not consume the ES search budget; otherwise peer-verification drill-ins
 * would starve the search budget the agent needs to locate candidate
 * shelves in the first place.
 *
 * `used` and `paths` are mutable per-request accumulation state, mirroring
 * SearchBudget: the listChildren tool increments `used` and records each
 * requested parent path BEFORE delegating, so the trace and the limit
 * enforcement stay consistent even when the underlying listing fails.
 */
export type ChildListingBudget = {
  readonly limit: number;
  used: number;
  readonly paths: string[];
};

/**
 * Extension of the shared Mastra request-context shape for the
 * suggest-path agent. The shared shape (`MastraRequestContextShape`)
 * stays unmodified: this type only ADDS the `searchBudget` and
 * `childListingBudget` keys, so shared tools (getPageContentTool,
 * fullTextSearchTool) keep reading `user` / `searchService` as before
 * (Requirement 1.5).
 */
export type SuggestPathRequestContextShape = MastraRequestContextShape & {
  searchBudget: SearchBudget;
  childListingBudget: ChildListingBudget;
};
