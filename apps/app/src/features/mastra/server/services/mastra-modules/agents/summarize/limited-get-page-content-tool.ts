import type { RequestContext } from '@mastra/core/request-context';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import loggerFactory from '~/utils/logger';

import { getPageContentTool } from '../../tools/get-page-content-tool';
import { fitPageToBudget, isPageReadBudgetExhausted } from './page-read-budget';
import type { SummarizeRequestContextShape } from './request-context';

const logger = loggerFactory(
  'growi:mastra:agents:summarize:limited-get-page-content-tool',
);

// Typed view of RequestContext bound to the summarize shape so that
// ctx.get('pageReadBudget') is statically inferred.
type TypedRequestContext = RequestContext<SummarizeRequestContextShape>;

// MAX_STEPS is sized for reads of this many lines (design.md SummarizeAgent).
const READ_LIMIT_LINES = 500;

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

/**
 * Budget-enforcing wrapper around {@link getPageContentTool}, used only by
 * the summarizeAgent. The budget counts characters sent to the LLM
 * (design.md LimitedGetPageContentTool):
 *
 * 1. `pageReadBudget` or `targetPageId` missing from requestContext ->
 *    `context_error` (no throw)
 * 2. budget exhausted -> `limit_exceeded` WITHOUT delegating
 * 3. otherwise delegate, then charge the outline and body actually returned,
 *    cutting the body at the remaining room
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
    const targetPageId = ctx.get('targetPageId');

    if (pageReadBudget == null || targetPageId == null) {
      logger.warn(
        'limited-get-page-content-tool: pageReadBudget or targetPageId missing in requestContext',
      );
      return {
        result: 'context_error' as const,
        reason: 'pageReadBudget or targetPageId missing in requestContext',
      };
    }

    if (isPageReadBudgetExhausted(pageReadBudget)) {
      return {
        result: 'limit_exceeded' as const,
        reason: `page read budget exhausted (${pageReadBudget.used}/${pageReadBudget.limit} characters used); finalize the summary from the content already read`,
      };
    }

    // biome-ignore lint/style/noNonNullAssertion: createTool always wires execute
    const result = await getPageContentTool.execute!(
      // pageId wins over pagePath in the delegate, so this pins the read.
      { ...inputData, pageId: targetPageId, limit: READ_LIMIT_LINES },
      context,
    );
    const typedResult = result as LimitedGetPageContentToolOutput;

    if (typedResult.result !== 'ok') {
      return typedResult;
    }

    const { page, consumed } = fitPageToBudget(
      typedResult.page,
      pageReadBudget.limit - pageReadBudget.used,
    );
    pageReadBudget.used += consumed;
    return { ...typedResult, page };
  },
});
