import { sanitizeEndpointForIndex } from '~/server/service/search-delegator/sanitize-endpoint-for-index';

export type ThresholdKeyPattern = readonly [string, RegExp];

// This intentionally does NOT share code with rate-limiter/middleware/factory.ts's
// regex-key matcher, despite the similar shape (both precompile a map of
// endpoint-pattern keys and match a request path against them): that matcher anchors
// only at the start (`^key`, no trailing `$`) and resolves multiple matches by taking
// the LAST one in declaration order (an unguarded `forEach` overwrite), whereas this
// one anchors both ends and takes the FIRST match. Unifying them would change one
// side's matching behavior on a live, security-relevant request path (auth rate
// limiting) without a dedicated review of that behavior change — keep them separate
// and update both if the underlying matching need ever changes.
export const compileThresholdKeyPatterns = (
  keys: readonly string[],
): readonly ThresholdKeyPattern[] =>
  keys.map((key) => [key, new RegExp(`^${key}$`)] as const);

/**
 * Find which configured threshold key (if any) matches the given endpoint.
 * `endpoint` is expected to be `req.originalUrl` (see add-activity.ts) and is
 * sanitized with the same helper the ES delegator uses before matching, so a
 * query string or a `/forgot-password/<token>` dynamic segment doesn't miss.
 */
export const matchThresholdKey = (
  patterns: readonly ThresholdKeyPattern[],
  endpoint: string,
): string | undefined => {
  const sanitized = sanitizeEndpointForIndex(endpoint);
  return patterns.find(([, pattern]) => pattern.test(sanitized))?.[0];
};
