import type { RequestContext } from '@mastra/core/request-context';
import { createTool } from '@mastra/core/tools';
import mongoose from 'mongoose';
import { z } from 'zod';

import { populateDataToShowRevision } from '~/server/models/obsolete-page';
import type { PageDocument, PageModel } from '~/server/models/page';
import loggerFactory from '~/utils/logger';

import type { MastraRequestContextShape } from '../types/request-context';

const logger = loggerFactory('growi:tools:get-page-content-tool');

// Typed view of RequestContext bound to the shared shape so that
// ctx.get('user') is statically inferred.
type TypedRequestContext = RequestContext<MastraRequestContextShape>;

const inputSchema = z
  .object({
    pageId: z.string().optional().describe('MongoDB ObjectId of the page'),
    pagePath: z.string().optional().describe('Page path starting with "/"'),
  })
  .refine((input) => input.pageId != null || input.pagePath != null, {
    message: 'Either pageId or pagePath must be provided',
  });

const outputSchema = z.discriminatedUnion('result', [
  z.object({
    result: z.literal('ok'),
    page: z.object({
      path: z.string(),
      body: z.string(),
      updatedAt: z.string(),
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
]);

export const getPageContentTool = createTool({
  id: 'get-page-content-tool',
  description:
    'Fetch the Markdown body of a wiki page by pageId or pagePath, respecting viewer permissions. Returns the body, page path, and last update time, or a structured failure result on missing input, missing context, or denied / missing page. Use this after full-text-search-tool to read the body of a promising hit.',
  inputSchema,
  outputSchema,

  execute: async (inputData, context) => {
    const { pageId, pagePath } = inputData;

    const ctx = context.requestContext as TypedRequestContext;
    const user = ctx.get('user');

    // Defensive context guard. The post-message handler populates this key
    // under normal flow, but the Mastra runtime resolves it dynamically so
    // we still type-guard at the tool boundary.
    if (user == null) {
      logger.warn('get-page-content-tool: missing user in requestContext');
      return {
        result: 'context_error' as const,
        reason: 'user missing in requestContext',
      };
    }

    // Defense-in-depth runtime check. zod's refine should already guarantee
    // at least one of pageId / pagePath is present, but the tool boundary
    // must still convert any direct invocation slip into the structured
    // failure value (parallels the context guard above).
    if (pageId == null && pagePath == null) {
      return {
        result: 'missing_input' as const,
        reason: 'pageId or pagePath required',
      };
    }

    const Page = mongoose.model<PageDocument, PageModel>('Page');

    try {
      // Grant resolution is fully delegated to Page.findByIdAndViewer /
      // findByPathAndViewer. Both methods auto-resolve the calling user's
      // user-group memberships internally (see page.ts:704-712), so we do
      // NOT compute userGroups here. Passing the user alone is sufficient.
      const page =
        pageId != null
          ? await Page.findByIdAndViewer(pageId, user)
          : // useFindOne=true selects the single-document overload; null
            // userGroups triggers the internal auto-resolution path.
            await Page.findByPathAndViewer(
              pagePath as string,
              user,
              null,
              true,
            );

      if (page == null) {
        return {
          result: 'not_found_or_forbidden' as const,
          reason: 'page not found or viewer is not permitted',
        };
      }

      // Populate revision so page.revision.body (Markdown) is available.
      // Empty userPublicFields is fine — we only need the revision body here.
      await populateDataToShowRevision(page, '');

      const body = String(
        page.revision != null &&
          typeof page.revision === 'object' &&
          'body' in page.revision
          ? ((page.revision as { body?: unknown }).body ?? '')
          : '',
      );
      const path = page.path;
      const updatedAt = (page.updatedAt as Date).toISOString();

      return {
        result: 'ok' as const,
        page: { path, body, updatedAt },
      };
    } catch (err) {
      // Never throw out of execute: convert exceptions into a structured
      // failure value so the agent loop can continue. The error table in
      // design.md routes unexpected Mongoose errors to the common
      // not_found_or_forbidden bucket.
      logger.error('get-page-content-tool failed', err);
      const reason =
        err instanceof Error && err.message.length > 0
          ? err.message
          : 'fetch_failed';
      return {
        result: 'not_found_or_forbidden' as const,
        reason,
      };
    }
  },
});
