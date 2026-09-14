import type { MastraRequestContextShape } from '../../types/request-context';

/**
 * Per-request page-read budget propagated through the request context.
 *
 * `used` is intentionally mutable: it is per-request accumulation state
 * scoped to a single RequestContext instance and is never shared across
 * request boundaries (Requirement 1.5 — concurrent requests must not leak
 * budget consumption into each other). The limited get-page-content tool
 * increments `used` by the number of lines actually returned, BEFORE
 * returning the result, so the budget check on the next call is always
 * consistent with what has actually been read so far.
 */
export type PageReadBudget = {
  readonly limit: number;
  used: number;
};

/**
 * Extension of the shared Mastra request-context shape for the summarize
 * agent. The shared shape (`MastraRequestContextShape`) stays unmodified:
 * this type only ADDS the `pageReadBudget` key, so the wrapped
 * `getPageContentTool` keeps reading `user` as before.
 */
export type SummarizeRequestContextShape = MastraRequestContextShape & {
  pageReadBudget: PageReadBudget;
};
