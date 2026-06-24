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

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import type { ChangesIndexRequestQuery } from '../../interfaces/dto/changes-index';
import { decodeCursor } from '../cursor';
import {
  listChanges,
  type NormalizedChangesQuery,
} from '../service/changes-index-service';

const logger = loggerFactory('growi:routes:apiv3:revision-diff:changes');

/** Default and maximum page size for the changes index. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

type Req = Request<
  Record<string, string>,
  ApiV3Response,
  undefined,
  ChangesIndexRequestQuery
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
 *            description: >
 *              Invalid query parameters: invalid date range, malformed cursor, or a
 *              `since`/`fromDate` older than the configured lookback limit
 *              (error code `lookback-limit-exceeded`). When no lower bound is given, the
 *              lookback limit is applied as the window's lower bound instead of erroring.
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

      // The target user is always fixed to the authenticated `user` — never taken from
      // query params (Req 2.1, 2.2). The service derives the userId from `user`.

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

      // Lookback limit (Req 10): cap how far back the request may reach. Each cursor page
      // recomputes runs over the window, so an unbounded lower bound makes the worst-case
      // scan unbounded. An explicit lower bound older than the floor is rejected; when no
      // lower bound is given, the floor itself becomes the window's lower bound.
      const maxLookbackSeconds = configManager.getConfig(
        'app:revisionDiffMaxLookbackSeconds',
      );
      const lookbackFloor = new Date(Date.now() - maxLookbackSeconds * 1000);
      if (lowerBound != null && lowerBound < lookbackFloor) {
        return res.apiv3Err(
          new ErrorV3(
            `since/fromDate must not be older than ${maxLookbackSeconds} seconds (lookback limit)`,
            'lookback-limit-exceeded',
          ),
          400,
        );
      }
      const effectiveSince = lowerBound ?? lookbackFloor;

      const limit =
        req.query.limit != null
          ? Number.parseInt(req.query.limit, 10)
          : DEFAULT_LIMIT;

      const normalizedQuery: NormalizedChangesQuery = {
        since: effectiveSince,
        toDate,
        limit,
        cursor: cursorKey,
      };

      try {
        const result = await listChanges(user, normalizedQuery);
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
