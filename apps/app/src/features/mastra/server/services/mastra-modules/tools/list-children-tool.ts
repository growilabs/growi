import type { RequestContext } from '@mastra/core/request-context';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { pageListingService } from '~/server/service/page-listing';
import loggerFactory from '~/utils/logger';

import type { SuggestPathRequestContextShape } from '../agents/suggest-path/request-context';

const logger = loggerFactory('growi:tools:list-children-tool');

// Typed view of RequestContext bound to the suggest-path shape so that
// ctx.get('user') / ctx.get('childListingBudget') are statically inferred.
type TypedRequestContext = RequestContext<SuggestPathRequestContextShape>;

// Defensive cap on the number of children echoed back to the agent. A broad
// category can hold hundreds of direct children; the agent only needs to see
// the shelf taking shape (which siblings accumulate here, and which of them
// have descendants of their own), not an exhaustive listing. The full set is
// still fetched (the listing query is already grant-filtered and lean), then
// truncated here so the response — and the token cost — stays bounded.
const CHILDREN_RESPONSE_CAP = 50;

const inputSchema = z.object({
  parentPath: z
    .string()
    .min(1)
    .describe(
      'Parent page path to list the direct children of, starting and ending with "/" (e.g. "/資料/内部仕様/"). Returns the pages that sit DIRECTLY under this path — its immediate children — not the whole subtree.',
    ),
});

const outputSchema = z.discriminatedUnion('result', [
  z.object({
    result: z.literal('ok'),
    // The path that was listed, echoed back so the agent can correlate the
    // response with the request when several listChildren calls interleave.
    parentPath: z.string(),
    children: z.array(
      z.object({
        path: z.string(),
        // Number of pages in the WHOLE subtree below this child. 0 means the
        // child is a leaf (a strong peer-placement signal); > 0 means the
        // child is itself a category the agent can drill into.
        descendantCount: z.number().int().nonnegative(),
        // True for GROWI "empty" pages — structural intermediate nodes that
        // have no body of their own (they exist only to host children). An
        // empty page is a container/shelf, not a document you would place a
        // peer beside.
        isEmpty: z.boolean(),
      }),
    ),
    // True when the real child count exceeded CHILDREN_RESPONSE_CAP and the
    // list was truncated, so the agent knows it is seeing a sample.
    truncated: z.boolean(),
  }),
  z.object({
    result: z.enum(['limit_exceeded', 'context_error', 'error']),
    reason: z.string(),
  }),
]);

type ListChildrenToolOutput = z.infer<typeof outputSchema>;

/**
 * Lists the DIRECT children of a wiki path for the suggestPathAgent, so the
 * agent can VERIFY a peer placement by observing which siblings actually
 * accumulate under a candidate category — instead of inferring the shelf from
 * search-hit paths alone (instructions Step 4).
 *
 * Execution rules (mirrors limited-search-tool's budget contract):
 *
 * 1. `childListingBudget` missing from requestContext -> `context_error`
 *    (no throw).
 * 2. `used >= limit` -> `limit_exceeded` WITHOUT delegating.
 * 3. otherwise increment `used`, record the path, then delegate to the
 *    grant-aware pageListingService. Permission filtering is the listing
 *    service's responsibility (it applies the viewer condition), so denied
 *    pages never appear — matching full-text-search-tool's grant handling.
 *
 * Body is intentionally NOT returned: like full-text-search-tool, this tool
 * exposes only structural metadata (path / descendantCount / isEmpty). Body
 * retrieval remains getPageContentTool's job.
 */
export const listChildrenTool = createTool({
  id: 'list-children-tool',
  description:
    'List the DIRECT children of a wiki path (the pages immediately under it), respecting viewer permissions. Use this AFTER full-text search has pointed you at a likely parent category, to confirm the document belongs there as a sibling: it shows which pages already accumulate directly under that path and, for each, its descendantCount (0 = a leaf page; > 0 = a sub-category you can drill into) and whether it is an empty container page. Does not return page body; use get-page-content-tool to read a body. Each call consumes one unit of a separate listing budget; when exhausted it returns result: "limit_exceeded".',
  inputSchema,
  outputSchema,

  execute: async (inputData, context): Promise<ListChildrenToolOutput> => {
    const { parentPath } = inputData;

    const ctx = context.requestContext as TypedRequestContext;
    const user = ctx.get('user');
    const childListingBudget = ctx.get('childListingBudget');

    // Defensive context guards. Under normal flow the engine populates both
    // keys, but the Mastra runtime resolves them dynamically so we type-guard
    // at the tool boundary (parallels full-text-search-tool / limited-search).
    if (user == null) {
      logger.warn('list-children-tool: missing user in requestContext');
      return {
        result: 'context_error' as const,
        reason: 'user missing in requestContext',
      };
    }
    if (childListingBudget == null) {
      logger.warn(
        'list-children-tool: childListingBudget missing in requestContext',
      );
      return {
        result: 'context_error' as const,
        reason: 'childListingBudget missing in requestContext',
      };
    }

    if (childListingBudget.used >= childListingBudget.limit) {
      return {
        result: 'limit_exceeded' as const,
        reason: `child listing budget exhausted (${childListingBudget.used}/${childListingBudget.limit} listings used); finalize suggestions from collected information`,
      };
    }

    // Consume the budget and record the path BEFORE delegating so a failed
    // listing attempt still counts against the limit and appears in the
    // trace — same ordering invariant as limited-search-tool.
    childListingBudget.used += 1;
    childListingBudget.paths.push(parentPath);

    try {
      // The listing service applies the viewer condition internally, so the
      // returned children are already grant-filtered for `user`. Passing the
      // path (it has a slash) selects the path-regex branch; the default
      // showPagesRestrictedBy* = false keeps owner/group-restricted pages
      // hidden, matching the wiki's normal listing visibility.
      const childPages =
        await pageListingService.findChildrenByParentPathOrIdAndViewer(
          parentPath,
          user,
        );

      const truncated = childPages.length > CHILDREN_RESPONSE_CAP;
      const children = childPages
        .slice(0, CHILDREN_RESPONSE_CAP)
        .map((page) => ({
          path: page.path ?? '',
          descendantCount: page.descendantCount ?? 0,
          isEmpty: page.isEmpty ?? false,
        }));

      return {
        result: 'ok' as const,
        parentPath,
        children,
        truncated,
      };
    } catch (err) {
      // Never throw out of execute: convert exceptions into a structured
      // failure value so the agent loop can continue (parallels the other
      // tools' no-throw contract).
      logger.error('list-children-tool: listing failed', err);
      const reason =
        err instanceof Error && err.message.length > 0
          ? err.message
          : 'listing_failed';
      return {
        result: 'error' as const,
        reason,
      };
    }
  },
});
