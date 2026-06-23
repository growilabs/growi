/**
 * GET /api/v3/revisions/changes — Changes Index route
 *
 * Returns a paginated list of the authenticated user's consecutive-edit "runs"
 * across all pages, with accessibility flags.
 *
 * Middleware order (per design.md Implementation Note):
 *   accessTokenParser → loginRequired → express-validator → apiV3FormValidator
 */

import assert from 'node:assert';
import { type IUserHasId, SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { query } from 'express-validator';
import type { HydratedDocument } from 'mongoose';
import mongoose, { Types } from 'mongoose';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { PageDocument, PageModel } from '~/server/models/page';
import { Revision } from '~/server/models/revision';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import type { ChangesIndexResult } from '../../interfaces/changes-index';
import { decodeCursor, encodeCursor } from '../cursor';
import {
  applyAccessFlags,
  buildRuns,
  type NormalizedChangesQuery,
  type PageInfo,
  paginateRuns,
  type RevisionWithContext,
} from '../service/changes-index-service';

const logger = loggerFactory('growi:routes:apiv3:revision-diff:changes');

/** Default and maximum page size for the changes index. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

type ReqQuery = {
  since?: string;
  fromDate?: string;
  toDate?: string;
  limit?: string;
  cursor?: string;
};

type Req = Request<
  Record<string, string>,
  ApiV3Response,
  undefined,
  ReqQuery
> & {
  user?: IUserHasId;
};

/**
 * Validator chain for GET /revisions/changes query parameters.
 */
const validator = [
  query('since')
    .optional()
    .isISO8601()
    .withMessage('since must be a valid ISO 8601 date'),
  query('fromDate')
    .optional()
    .isISO8601()
    .withMessage('fromDate must be a valid ISO 8601 date'),
  query('toDate')
    .optional()
    .isISO8601()
    .withMessage('toDate must be a valid ISO 8601 date'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: MAX_LIMIT })
    .withMessage(`limit must be an integer between 1 and ${MAX_LIMIT}`),
  query('cursor').optional().isString().withMessage('cursor must be a string'),
];

/**
 * @swagger
 *
 *    /revisions/changes:
 *      get:
 *        tags: [Revisions]
 *        summary: Get the authenticated user's consecutive-edit runs across all pages
 *        description: >
 *          Returns a paginated list of "runs" — maximal sequences of the authenticated
 *          user's consecutive edits on individual pages, not interrupted by another author.
 *          Each entry includes the baseline revision (from) and the final revision (to) of
 *          the run, along with page accessibility flags. The response is ordered by
 *          (latestUpdatedAt asc, toRevisionId asc) for stable incremental sync.
 *          Authentication requires a Personal Access Token with scope `read:features:page`.
 *        parameters:
 *          - in: query
 *            name: since
 *            schema:
 *              type: string
 *              format: date-time
 *            description: Inclusive lower bound on revision createdAt (ISO 8601).
 *          - in: query
 *            name: fromDate
 *            schema:
 *              type: string
 *              format: date-time
 *            description: >
 *              Start of the date range (inclusive). Combined with `since`: the effective
 *              lower bound is the later of the two values.
 *          - in: query
 *            name: toDate
 *            schema:
 *              type: string
 *              format: date-time
 *            description: >
 *              End of the date range (inclusive). Must not be earlier than `fromDate`;
 *              violating this constraint returns 400.
 *          - in: query
 *            name: limit
 *            schema:
 *              type: integer
 *              minimum: 1
 *              maximum: 100
 *              default: 20
 *            description: Maximum number of run entries to return.
 *          - in: query
 *            name: cursor
 *            schema:
 *              type: string
 *            description: >
 *              Opaque pagination cursor returned in the `next` field of a prior response.
 *              An invalid cursor token returns 400.
 *        responses:
 *          200:
 *            description: Paginated list of change-index entries
 *            content:
 *              application/json:
 *                schema:
 *                  properties:
 *                    changes:
 *                      type: array
 *                      items:
 *                        type: object
 *                        properties:
 *                          pageId:
 *                            type: string
 *                          path:
 *                            type: string
 *                            nullable: true
 *                            description: null when accessible is false
 *                          fromRevisionId:
 *                            type: string
 *                            nullable: true
 *                            description: null when the run starts from page creation
 *                          toRevisionId:
 *                            type: string
 *                          authorId:
 *                            type: string
 *                          latestUpdatedAt:
 *                            type: string
 *                            format: date-time
 *                          accessible:
 *                            type: boolean
 *                          deleted:
 *                            type: boolean
 *                    next:
 *                      type: string
 *                      nullable: true
 *                      description: Cursor token for the next page, or null when all results have been returned
 *          400:
 *            description: Invalid query parameters (invalid date range or malformed cursor)
 *          401:
 *            description: Not authenticated
 *          403:
 *            description: Insufficient scope (requires read:features:page)
 */

/**
 * Factory function that wires the Changes Index route handlers.
 *
 * @returns Express RequestHandler array to be spread into router.get().
 */
export const changesRouteHandlersFactory = (crowi: Crowi): RequestHandler[] => {
  const loginRequired = loginRequiredFactory(crowi, false);

  return [
    // biome-ignore lint/suspicious/noTsIgnore: Scope type causes "Type instantiation is excessively deep" with tsgo
    // @ts-ignore
    accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequired,
    ...validator,
    apiV3FormValidator,
    async (req: Req, res: ApiV3Response) => {
      const { user } = req;
      assert(
        user != null,
        'user is required (ensured by loginRequired middleware)',
      );

      // userId is always fixed to the authenticated user — never taken from query params (Req 2.1, 2.2).
      const userId = user._id.toString();

      // Decode cursor first; an invalid token results in 400 before further processing.
      let cursorKey: ReturnType<typeof decodeCursor> | undefined;
      if (req.query.cursor != null && req.query.cursor !== '') {
        try {
          cursorKey = decodeCursor(req.query.cursor);
        } catch {
          return res.apiv3Err(
            new ErrorV3('Invalid cursor token', 'invalid-cursor'),
            400,
          );
        }
      }

      // Resolve date bounds.
      const sinceDate =
        req.query.since != null ? new Date(req.query.since) : undefined;
      const fromDate =
        req.query.fromDate != null ? new Date(req.query.fromDate) : undefined;
      const toDate =
        req.query.toDate != null ? new Date(req.query.toDate) : undefined;

      // Validate date range: fromDate must not be after toDate (Req 1.5).
      if (fromDate != null && toDate != null && fromDate > toDate) {
        return res.apiv3Err(
          new ErrorV3(
            'fromDate must not be after toDate',
            'invalid-date-range',
          ),
          400,
        );
      }

      // The effective lower bound is the later of `since` and `fromDate`.
      let lowerBound: Date | undefined;
      if (sinceDate != null && fromDate != null) {
        lowerBound = sinceDate > fromDate ? sinceDate : fromDate;
      } else {
        lowerBound = sinceDate ?? fromDate;
      }

      const limit =
        req.query.limit != null
          ? Number.parseInt(req.query.limit, 10)
          : DEFAULT_LIMIT;

      const normalizedQuery: NormalizedChangesQuery = {
        since: lowerBound,
        toDate,
        limit,
        cursor: cursorKey,
      };

      try {
        const result = await listChanges(crowi, user, userId, normalizedQuery);
        return res.apiv3(result);
      } catch (err) {
        logger.error('Error in GET /revisions/changes', err);
        return res.apiv3Err(
          new ErrorV3(
            'Failed to retrieve changes',
            'failed-to-retrieve-changes',
          ),
          500,
        );
      }
    },
  ];
};

/**
 * Fetch the authenticated user's edit runs from MongoDB, apply accessibility flags,
 * and return a paginated ChangesIndexResult.
 *
 * This implements the ChangesIndexService.listChanges contract inline, as a concrete
 * service function scoped to this route factory.
 *
 * Pipeline:
 *   1. $match — filter by author + optional date bounds + keyset cursor
 *   2. $setWindowFields — compute prevAuthor / prevRevisionId per page (partitioned)
 *   3. $sort — (createdAt asc, _id asc) for stable ordering
 *   4. buildRuns() — group revisions into completed runs (pure)
 *   5. paginateRuns() — take up to `limit` runs with cursor support (pure)
 *   6. Page bulk queries — resolve accessibility + path for each run's pageId
 *   7. applyAccessFlags() — annotate entries with accessible/deleted/path (pure)
 *   8. encodeCursor() — produce opaque next-page token when more data exists
 */
async function listChanges(
  crowi: Crowi,
  user: IUserHasId,
  userId: string,
  query: NormalizedChangesQuery,
): Promise<ChangesIndexResult> {
  const authorObjectId = new Types.ObjectId(userId);

  // Build the post-window $match stage that selects only this user's revisions
  // within the requested window and cursor position.
  //
  // IMPORTANT: The $setWindowFields stage must run before this $match so that
  // prevAuthor / prevRevisionId are computed over ALL revisions on a page
  // (regardless of author).  Filtering by author first would cause the window
  // function to miss other-author revisions, making run-split detection (Req 4.2)
  // impossible.
  const postWindowMatch: Record<string, unknown> = {
    author: authorObjectId,
  };

  if (query.since != null || query.toDate != null) {
    const createdAtFilter: Record<string, Date> = {};
    if (query.since != null) createdAtFilter.$gte = query.since;
    if (query.toDate != null) createdAtFilter.$lte = query.toDate;
    postWindowMatch.createdAt = createdAtFilter;
  }

  // When resuming from a cursor, skip revisions at-or-before the cursor position
  // using a compound keyset predicate: (createdAt, _id) > (cursor.createdAt, cursor.id).
  if (query.cursor != null) {
    const cursorCreatedAt = query.cursor.createdAt;
    const cursorId = new Types.ObjectId(query.cursor.id);
    postWindowMatch.$or = [
      { createdAt: { $gt: cursorCreatedAt } },
      {
        createdAt: { $eq: cursorCreatedAt },
        _id: { $gt: cursorId },
      },
    ];
  }

  // Pre-filter: narrow to pages that have at least one revision by this user
  // in the requested window to avoid scanning the entire revisions collection.
  // This keeps the full-collection scan bounded while still allowing $setWindowFields
  // to see all revisions on those pages (including other-author ones).
  const authorPageIds: Types.ObjectId[] = await Revision.distinct('pageId', {
    author: authorObjectId,
    ...(postWindowMatch.createdAt != null
      ? { createdAt: postWindowMatch.createdAt }
      : {}),
  });

  const rawRevisions: RevisionWithContext[] = await Revision.aggregate([
    // Step 1: restrict to pages where the user has revisions (performance gate).
    { $match: { pageId: { $in: authorPageIds } } },
    // Step 2: enrich each revision with the immediately-preceding revision on the
    // same page (author-agnostic), so run boundaries can be detected correctly.
    {
      $setWindowFields: {
        partitionBy: '$pageId',
        sortBy: { createdAt: 1, _id: 1 },
        output: {
          prevAuthor: { $shift: { output: '$author', by: -1 } },
          prevRevisionId: { $shift: { output: '$_id', by: -1 } },
        },
      },
    },
    // Step 3: keep only the authenticated user's revisions within the window.
    { $match: postWindowMatch },
    { $sort: { createdAt: 1, _id: 1 } },
  ]);

  // Group revisions into completed runs.
  const runs = buildRuns(rawRevisions, authorObjectId);

  // Apply keyset pagination.
  const { emittedRuns, nextCursor } = paginateRuns(
    runs,
    query.limit,
    query.cursor,
  );

  if (emittedRuns.length === 0) {
    return { changes: [], next: null };
  }

  // Collect all pageIds from emitted runs for bulk accessibility check.
  const pageIds = emittedRuns.map((r) => r.pageId);

  // Bulk query 1: determine which pages the authenticated user can access.
  const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
    'Page',
  );
  const accessiblePages: HydratedDocument<PageDocument>[] =
    await Page.findByIdsAndViewer(pageIds, user, null);
  const accessiblePageIds = new Set(
    accessiblePages.map((p) => p._id.toString()),
  );

  // Bulk query 2: fetch status and path for all pages (to detect deleted pages).
  const pageInfoDocs: PageInfo[] = await Page.find(
    { _id: { $in: pageIds } },
    { status: 1, path: 1 },
  ).lean();
  const pageInfoMap = new Map<string, PageInfo>(
    pageInfoDocs.map((p) => [p._id.toString(), p]),
  );

  // Annotate runs with accessibility flags.
  const changes = applyAccessFlags(emittedRuns, accessiblePageIds, pageInfoMap);

  // Encode the next-page cursor.
  const next = nextCursor != null ? encodeCursor(nextCursor) : null;

  return { changes, next };
}
