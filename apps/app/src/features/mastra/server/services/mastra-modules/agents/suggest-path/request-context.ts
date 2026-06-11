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
 * Extension of the shared Mastra request-context shape for the
 * suggest-path agent. The shared shape (`MastraRequestContextShape`)
 * stays unmodified: this type only ADDS the `searchBudget` key, so
 * shared tools (getPageContentTool, fullTextSearchTool) keep reading
 * `user` / `searchService` as before (Requirement 1.5).
 */
export type SuggestPathRequestContextShape = MastraRequestContextShape & {
  searchBudget: SearchBudget;
};
