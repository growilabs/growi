import type { RequestContext } from '@mastra/core/request-context';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import loggerFactory from '~/utils/logger';

import { fullTextSearchTool } from '../../tools/full-text-search-tool';
import type { SuggestPathRequestContextShape } from './request-context';

const logger = loggerFactory(
  'growi:mastra:agents:suggest-path:limited-search-tool',
);

// Typed view of RequestContext bound to the suggest-path shape so that
// ctx.get('searchBudget') is statically inferred.
type TypedRequestContext = RequestContext<SuggestPathRequestContextShape>;

// The wrapped tool's discriminated union (ok / error / context_error)
// extended with limit_exceeded — the wrap-up signal for Requirement 3.2.
// The ok / error members are restated here because the original tool keeps
// its schema module-private; the INPUT schema, by contrast, is shared by
// reference below so it can never drift.
const outputSchema = z.discriminatedUnion('result', [
  z.object({
    result: z.literal('ok'),
    hits: z.array(
      z.object({
        pageId: z.string(),
        pagePath: z.string(),
        snippet: z.string().optional(),
      }),
    ),
    totalCount: z.number().int().nonnegative(),
  }),
  z.object({
    result: z.enum(['error', 'context_error']),
    reason: z.string(),
  }),
  z.object({
    result: z.literal('limit_exceeded'),
    reason: z.string(),
  }),
]);

type LimitedSearchToolOutput = z.infer<typeof outputSchema>;

/**
 * Budget-enforcing wrapper around {@link fullTextSearchTool}, used only by
 * the suggestPathAgent. Execution rules (design.md LimitedSearchTool):
 *
 * 1. `searchBudget` missing from requestContext -> `context_error` (no throw)
 * 2. `used >= limit` -> `limit_exceeded` WITHOUT delegating
 * 3. otherwise increment `used`, record the query, then delegate verbatim —
 *    permission filtering stays the delegate's responsibility (Requirement 1.5)
 *
 * The shared fullTextSearchTool is NOT modified.
 */
export const limitedSearchTool = createTool({
  id: 'limited-search-tool',
  description:
    'Full-text search across the GROWI wiki with a per-request search budget. Behaves exactly like the standard full-text search, but each call consumes one search from the budget; when the budget is exhausted it returns result: "limit_exceeded" — at that point stop searching and finalize suggestions from the information already collected.',
  // Share the wrapped tool's input schema BY REFERENCE: the wrapper's input
  // contract (query / limit / sort / order, defaults included) is identical
  // by construction and auto-tracks any future change to the original.
  // biome-ignore lint/style/noNonNullAssertion: fullTextSearchTool is created with an inputSchema
  inputSchema: fullTextSearchTool.inputSchema!,
  outputSchema,

  execute: async (inputData, context): Promise<LimitedSearchToolOutput> => {
    const ctx = context.requestContext as TypedRequestContext;
    const searchBudget = ctx.get('searchBudget');

    if (searchBudget == null) {
      logger.warn(
        'limited-search-tool: searchBudget missing in requestContext',
      );
      return {
        result: 'context_error' as const,
        reason: 'searchBudget missing in requestContext',
      };
    }

    if (searchBudget.used >= searchBudget.limit) {
      return {
        result: 'limit_exceeded' as const,
        reason: `search budget exhausted (${searchBudget.used}/${searchBudget.limit} searches used); finalize suggestions from collected information`,
      };
    }

    // Consume the budget and record the query BEFORE delegating so a failed
    // search attempt still counts against the limit (Requirement 3.1) and
    // appears in the exploration trace (Requirement 2.4).
    searchBudget.used += 1;
    searchBudget.queries.push(inputData.query);

    try {
      // Forward (inputData, context) verbatim — delegation mechanism verified
      // by spike (research.md "Spike Results" item 2). The delegate reads
      // user / searchService from the same requestContext, so permission
      // filtering is handled by the existing grant-aware search path.
      // biome-ignore lint/style/noNonNullAssertion: createTool always wires execute
      const result = await fullTextSearchTool.execute!(inputData, context);
      return result as LimitedSearchToolOutput;
    } catch (err) {
      // The delegate's own contract is to never throw, but the wrapper
      // guarantees the no-throw contract independently (design Error
      // Handling: the tool layer returns discriminated unions as values).
      logger.error('limited-search-tool: delegation failed', err);
      const reason =
        err instanceof Error && err.message.length > 0
          ? err.message
          : 'search_failed';
      return {
        result: 'error' as const,
        reason,
      };
    }
  },
});
