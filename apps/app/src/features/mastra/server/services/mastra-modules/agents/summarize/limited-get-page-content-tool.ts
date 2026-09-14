import type { RequestContext } from '@mastra/core/request-context';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import loggerFactory from '~/utils/logger';

import { getPageContentTool } from '../../tools/get-page-content-tool';
import type { SummarizeRequestContextShape } from './request-context';

const logger = loggerFactory(
  'growi:mastra:agents:summarize:limited-get-page-content-tool',
);

// Typed view of RequestContext bound to the summarize shape so that
// ctx.get('pageReadBudget') is statically inferred.
type TypedRequestContext = RequestContext<SummarizeRequestContextShape>;

// The wrapped tool's discriminated union, restated here because the
// original tool keeps its schema module-private, extended with
// limit_exceeded — the budget wrap-up signal. The INPUT schema, by
// contrast, is shared by reference below so it can never drift.
const outputSchema = z.discriminatedUnion('result', [
  z.object({
    result: z.literal('ok'),
    page: z.object({
      pageId: z.string(),
      path: z.string(),
      updatedAt: z.string().optional(),
      totalLines: z.number().int().nonnegative(),
      content: z.string().optional(),
      offset: z.number().int().positive().optional(),
      limit: z.number().int().positive().optional(),
      hasMore: z.boolean().optional(),
      outline: z
        .array(
          z.object({
            line: z.number().int().positive(),
            level: z.number().int().min(1).max(6),
            heading: z.string(),
          }),
        )
        .optional(),
    }),
  }),
  z.object({
    result: z.enum([
      'not_found_or_forbidden',
      'missing_input',
      'context_error',
    ]),
    reason: z.string(),
  }),
  z.object({
    result: z.literal('limit_exceeded'),
    reason: z.string(),
  }),
]);

type LimitedGetPageContentToolOutput = z.infer<typeof outputSchema>;

// Counts the number of lines in a returned content slice. `content` never
// carries a trailing newline (see get-page-content-tool's scanBody CRLF
// contract), so splitting on '\n' yields exactly the line count.
const countLines = (content: string): number => content.split('\n').length;

/**
 * Budget-enforcing wrapper around {@link getPageContentTool}, used only by
 * the summarizeAgent. Execution rules (design.md LimitedGetPageContentTool):
 *
 * 1. `pageReadBudget` missing from requestContext -> `context_error` (no throw)
 * 2. `used >= limit` -> `limit_exceeded` WITHOUT delegating (used/limit unchanged)
 * 3. otherwise delegate verbatim, then increment `used` by the number of
 *    lines actually returned in `content`
 * 4. `content` is `undefined` (outline-only call, or a failure response) ->
 *    do NOT increment `used` (no body lines were consumed)
 *
 * The shared getPageContentTool is NOT modified.
 */
export const limitedGetPageContentTool = createTool({
  id: 'limited-get-page-content-tool',
  description: getPageContentTool.description,
  // Share the wrapped tool's input schema BY REFERENCE: the wrapper's input
  // contract is identical by construction and auto-tracks any future change
  // to the original.
  // biome-ignore lint/style/noNonNullAssertion: getPageContentTool is created with an inputSchema
  inputSchema: getPageContentTool.inputSchema!,
  outputSchema,

  execute: async (
    inputData,
    context,
  ): Promise<LimitedGetPageContentToolOutput> => {
    const ctx = context.requestContext as TypedRequestContext;
    const pageReadBudget = ctx.get('pageReadBudget');

    if (pageReadBudget == null) {
      logger.warn(
        'limited-get-page-content-tool: pageReadBudget missing in requestContext',
      );
      return {
        result: 'context_error' as const,
        reason: 'pageReadBudget missing in requestContext',
      };
    }

    if (pageReadBudget.used >= pageReadBudget.limit) {
      return {
        result: 'limit_exceeded' as const,
        reason: `page read budget exhausted (${pageReadBudget.used}/${pageReadBudget.limit} lines used); finalize the summary from the content already read`,
      };
    }

    // biome-ignore lint/style/noNonNullAssertion: createTool always wires execute
    const result = await getPageContentTool.execute!(inputData, context);
    const typedResult = result as LimitedGetPageContentToolOutput;

    // Only a successful response with `content` actually consumed body
    // lines (outline-only responses and failure responses did not).
    if (typedResult.result === 'ok' && typedResult.page.content != null) {
      pageReadBudget.used += countLines(typedResult.page.content);
    }

    return typedResult;
  },
});
