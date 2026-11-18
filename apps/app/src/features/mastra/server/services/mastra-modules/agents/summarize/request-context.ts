import type { MastraRequestContextShape } from '../../types/request-context';

/**
 * Per-request page-read budget propagated through the request context, in
 * characters sent to the LLM.
 *
 * `used` is intentionally mutable: it is per-request accumulation state
 * scoped to a single RequestContext instance and is never shared across
 * request boundaries (Requirement 1.5 — concurrent requests must not leak
 * budget consumption into each other). The limited get-page-content tool
 * increments `used` by the characters actually returned, BEFORE returning
 * the result, so the budget check on the next call and the route's
 * per-step tool gate are always consistent with what has been read.
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
  // The page the route resolved; every read is pinned to it.
  targetPageId: string;
};
