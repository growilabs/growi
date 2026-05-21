import type { RequestContext } from '@mastra/core/request-context';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import type { ISearchResultData } from '~/interfaces/search';
import UserGroupRelation from '~/server/models/user-group-relation';
import loggerFactory from '~/utils/logger';

import type { MastraRequestContextShape } from '../types/request-context';

const logger = loggerFactory('growi:tools:full-text-search-tool');

// Typed view of RequestContext bound to the shared shape so that
// ctx.get('user') / ctx.get('searchService') are statically inferred.
type TypedRequestContext = RequestContext<MastraRequestContextShape>;

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      [
        'Search query for the GROWI wiki full-text index.',
        'Write in the user input language; tokens may be combined with the following operators (all optional):',
        '  - "word"            : phrase match (e.g. "release notes")',
        '  - -word / -"phrase" : exclude term / phrase',
        '  - prefix:/path      : restrict to a page-path subtree (e.g. prefix:/docs/install)',
        '  - -prefix:/path     : exclude a subtree',
        '  - tag:foo           : restrict to pages tagged foo',
        '  - -tag:foo          : exclude pages tagged foo',
        'Operators are AND-combined. Use them only when the user intent clearly maps to a subtree, tag, or exclusion; otherwise prefer plain natural language tokens.',
      ].join('\n'),
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(20)
    .optional()
    .default(10)
    .describe('Maximum number of hits to return'),
});

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
]);

type FullTextSearchHit = {
  pageId: string;
  pagePath: string;
  snippet?: string;
};

export const fullTextSearchTool = createTool({
  id: 'full-text-search-tool',
  description:
    'Full-text search across the GROWI wiki. Returns viewer-permitted candidate pages (pageId, pagePath, optional snippet) for the calling user via the existing grant-aware search path. Does not return page body; use get-page-content-tool to fetch the body for promising hits.',
  inputSchema,
  outputSchema,

  execute: async (inputData, context) => {
    const { query, limit } = inputData;

    const ctx = context.requestContext as TypedRequestContext;
    const user = ctx.get('user');
    const searchService = ctx.get('searchService');

    // Defensive context guard. Under normal flow the post-message handler
    // populates both keys, but the Mastra runtime resolves them dynamically
    // so we must still type-guard at the tool boundary.
    if (user == null || searchService == null) {
      logger.warn(
        'full-text-search-tool: missing user or searchService in requestContext',
      );
      return {
        result: 'context_error' as const,
        reason: 'user or searchService missing in requestContext',
      };
    }

    // Early return when Elasticsearch is not configured (OSS deployments
    // without ES URI). The agent will fall back to its standard response
    // policy without invoking the search delegator.
    if (searchService.isElasticsearchEnabled === false) {
      logger.warn('full-text-search-tool: elasticsearch is not configured');
      return {
        result: 'error' as const,
        reason: 'elasticsearch_not_configured',
      };
    }

    try {
      // Resolve user-group ids the same way as the existing /_search route
      // (server/routes/search.ts:143-151): SearchService does NOT resolve
      // them internally, so GRANT_USER_GROUP pages would be hidden from
      // members otherwise.
      const userGroups = [
        ...(await UserGroupRelation.findAllUserGroupIdsRelatedToUser(user)),
        ...(await ExternalUserGroupRelation.findAllUserGroupIdsRelatedToUser(
          user,
        )),
      ];

      // Pass query through unchanged: SearchService.parseQueryString interprets
      // operators (prefix:, tag:, "phrase", -word, ...). Do NOT sanitize or
      // rewrite the query string here — that would duplicate the parser.
      const [searchResult, _delegatorName] = await searchService.searchKeyword(
        query,
        null,
        user,
        userGroups,
        { limit },
      );

      // searchResult is typed as ISearchResult<unknown> at the SearchService
      // boundary; narrow each entry to ISearchResultData to access _id /
      // _source.path / _highlight.body indexed by the ES delegator.
      const rawData = searchResult.data as ISearchResultData[];
      const hits: FullTextSearchHit[] = rawData.map((data) => {
        // Pick only the fields needed for the agent. Never spread `_source`:
        // it contains `body` (full Markdown), which must not leak from this
        // tool (requirement 6.5 — body retrieval belongs to getPageContentTool).
        const hit: FullTextSearchHit = {
          pageId: String(data._id),
          pagePath: data._source?.path,
        };
        const snippet = data._highlight?.body?.[0];
        if (typeof snippet === 'string' && snippet.length > 0) {
          hit.snippet = snippet;
        }
        return hit;
      });

      return {
        result: 'ok' as const,
        hits,
        totalCount: searchResult.meta.total,
      };
    } catch (err) {
      // Never throw out of execute (requirement 6.8): convert exceptions into
      // a structured failure value so the agent loop can continue.
      logger.error('full-text-search-tool failed', err);
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
