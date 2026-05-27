import type { RequestContext } from '@mastra/core/request-context';
import { createTool } from '@mastra/core/tools';
import type { Heading } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toString as mdastToString } from 'mdast-util-to-string';
import mongoose from 'mongoose';
import { visit } from 'unist-util-visit';
import { z } from 'zod';

import { populateDataToShowRevision } from '~/server/models/obsolete-page';
import type { PageDocument, PageModel } from '~/server/models/page';
import loggerFactory from '~/utils/logger';

import type { MastraRequestContextShape } from '../types/request-context';

const logger = loggerFactory('growi:tools:get-page-content-tool');

// Typed view of RequestContext bound to the shared shape so that
// ctx.get('user') is statically inferred.
type TypedRequestContext = RequestContext<MastraRequestContextShape>;

type OutlineEntry = {
  line: number;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  heading: string;
};

// Build an outline from the page body by parsing it into a MDAST tree and
// visiting heading nodes. Handles ATX (`# h`) and Setext (`h\n===` / `h\n---`)
// headings; code blocks / HTML blocks are correctly excluded by the parser.
const extractOutline = (body: string): OutlineEntry[] => {
  const tree = fromMarkdown(body);
  const entries: OutlineEntry[] = [];
  visit(tree, 'heading', (node: Heading) => {
    // node.position is normally present for parsed input; guard defensively.
    if (node.position == null) return;
    entries.push({
      line: node.position.start.line,
      level: node.depth,
      heading: mdastToString(node),
    });
  });
  return entries;
};

const inputSchema = z
  .object({
    pageId: z.string().optional().describe('MongoDB ObjectId of the page'),
    pagePath: z.string().optional().describe('Page path starting with "/"'),
    offset: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "1-indexed start line. Omit on the first call to receive the page outline + first `limit` lines. Re-call with offset set to an outline entry's line number to jump to that section.",
      ),
    limit: z
      .number()
      .int()
      .positive()
      .max(500)
      .optional()
      .default(200)
      .describe('Maximum lines to return (default 200, max 500).'),
  })
  .refine((input) => input.pageId != null || input.pagePath != null, {
    message: 'Either pageId or pagePath must be provided',
  });

const outputSchema = z.discriminatedUnion('result', [
  z.object({
    result: z.literal('ok'),
    page: z.object({
      path: z.string(),
      updatedAt: z.string(),
      totalLines: z.number().int().nonnegative(),
      // Content fields are present only in "content mode" (offset provided, or
      // the small-page optimization on the first call). In "outline mode"
      // (offset omitted on a long page) they are omitted and `outline` carries
      // the heading list instead.
      content: z.string().optional(),
      offset: z.number().int().positive().optional(),
      limit: z.number().int().positive().optional(),
      hasMore: z.boolean().optional(),
      // Outline is present only on the first call (offset omitted).
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
]);

export const getPageContentTool = createTool({
  id: 'get-page-content-tool',
  description:
    "Fetch the Markdown body of a wiki page by pageId or pagePath, respecting viewer permissions. On the first call (offset omitted) returns the page outline plus the first `limit` lines; re-call with `offset` set to an outline entry's `line` to drill into a section. Returns a structured failure on missing input, missing context, or denied / missing page. Use this after full-text-search-tool to read the body of a promising hit.",
  inputSchema,
  outputSchema,

  execute: async (inputData, context) => {
    const { pageId, pagePath, offset, limit } = inputData;

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

      // Line-based pagination. Split on CRLF or LF to be newline-style agnostic.
      // Slicing is done entirely in memory; no additional DB queries are issued
      // (PR #11204 review FB: keep the Page.findByIdAndViewer path untouched).
      const allLines = body.split(/\r?\n/);
      const totalLines = allLines.length;

      // zod's .default(200) should fire, but assign explicitly so safeLimit
      // is statically narrowed to a number for the slice math below.
      const safeLimit = limit ?? 200;

      // === Mode selection (outline vs content) ===
      // `offset` omitted  → outline mode  (return the heading list; the agent
      //                      then drills into a section by re-calling with a
      //                      heading's line number as `offset`).
      // `offset` provided → content mode  (return the requested line slice).
      // Small-page optimization: when the whole page fits in one page
      // (totalLines <= limit), the first call also returns the content so the
      // agent can answer in a single round-trip without a follow-up call.
      const isFirstCall = offset == null;
      const fitsInOnePage = totalLines <= safeLimit;
      const includeOutline = isFirstCall;
      const includeContent = !isFirstCall || fitsInOnePage;

      const outline = includeOutline ? extractOutline(body) : undefined;

      // content fields are only computed / returned when includeContent holds.
      let contentFields:
        | {
            content: string;
            offset: number;
            limit: number;
            hasMore: boolean;
          }
        | undefined;
      if (includeContent) {
        // zod's .positive() already rejects offset <= 0; Math.max stays as a
        // defensive guard for clarity when offset is omitted (first call).
        const safeOffset = Math.max(1, offset ?? 1);
        const startIdx = safeOffset - 1; // 0-indexed
        const sliced = allLines.slice(startIdx, startIdx + safeLimit);
        // 0-indexed exclusive end of the returned range.
        const endIdx = startIdx + sliced.length;
        contentFields = {
          content: sliced.join('\n'),
          offset: safeOffset,
          limit: safeLimit,
          hasMore: endIdx < totalLines,
        };
      }

      return {
        result: 'ok' as const,
        page: {
          path,
          updatedAt,
          totalLines,
          ...(contentFields ?? {}),
          ...(outline != null ? { outline } : {}),
        },
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
