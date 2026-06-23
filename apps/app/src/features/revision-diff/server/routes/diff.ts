/**
 * POST /api/v3/revisions/diff — Revision Diff route
 *
 * Accepts a batch of revision pairs and returns per-pair unified diffs.
 * Authorization is performed independently per pair using the authenticated user's
 * page accessibility.
 *
 * Middleware order (per design.md Implementation Note):
 *   accessTokenParser → loginRequired → express-validator → apiV3FormValidator
 */

import assert from 'node:assert';
import { type IUserHasId, SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { body } from 'express-validator';
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

import type {
  RevisionDiffPairInput,
  RevisionDiffResponse,
} from '../../interfaces/revision-diff';
import {
  computeDiffForPair,
  MAX_PAIRS,
  type RevisionDoc,
} from '../service/revision-diff-service';

const logger = loggerFactory('growi:routes:apiv3:revision-diff:diff');

/** Default number of context lines in unified diff output. */
const DEFAULT_CONTEXT_LINES = 3;

type ReqBody = {
  pairs: RevisionDiffPairInput[];
  contextLines?: number;
};

type Req = Request<Record<string, string>, ApiV3Response, ReqBody> & {
  user?: IUserHasId;
};

/**
 * Validator chain for POST /revisions/diff body parameters.
 */
const validator = [
  body('pairs')
    .isArray({ max: MAX_PAIRS })
    .withMessage(`pairs must be an array with at most ${MAX_PAIRS} items`),
  body('pairs.*.pageId')
    .isMongoId()
    .withMessage('pairs[*].pageId must be a valid MongoDB ObjectId'),
  body('pairs.*.toRevisionId')
    .isMongoId()
    .withMessage('pairs[*].toRevisionId must be a valid MongoDB ObjectId'),
  body('pairs.*.fromRevisionId')
    .optional({ nullable: true })
    .isMongoId()
    .withMessage(
      'pairs[*].fromRevisionId must be a valid MongoDB ObjectId or null',
    ),
  body('contextLines')
    .optional()
    .isInt({ min: 0, max: 20 })
    .withMessage('contextLines must be an integer between 0 and 20'),
];

/**
 * @swagger
 *
 *    /revisions/diff:
 *      post:
 *        tags: [Revisions]
 *        summary: Compute unified diffs for a batch of revision pairs
 *        description: >
 *          Accepts a list of revision pairs (up to MAX_PAIRS) and returns a per-pair
 *          unified diff result. Authorization is performed independently per pair:
 *          pairs the authenticated user cannot view return status "forbidden";
 *          structurally invalid pairs (revision not found, wrong page) return status
 *          "invalid". Authentication requires a Personal Access Token with scope
 *          `read:features:page`.
 *        requestBody:
 *          required: true
 *          content:
 *            application/json:
 *              schema:
 *                type: object
 *                required:
 *                  - pairs
 *                properties:
 *                  pairs:
 *                    type: array
 *                    maxItems: 20
 *                    items:
 *                      type: object
 *                      required:
 *                        - pageId
 *                        - toRevisionId
 *                      properties:
 *                        pageId:
 *                          type: string
 *                          description: MongoDB ObjectId of the target page
 *                        toRevisionId:
 *                          type: string
 *                          description: MongoDB ObjectId of the "to" revision
 *                        fromRevisionId:
 *                          type: string
 *                          nullable: true
 *                          description: MongoDB ObjectId of the "from" revision, or null for page-creation baseline
 *                  contextLines:
 *                    type: integer
 *                    minimum: 0
 *                    maximum: 20
 *                    default: 3
 *                    description: Number of context lines in the unified diff output
 *        responses:
 *          200:
 *            description: Per-pair diff results in the same order as the request pairs
 *            content:
 *              application/json:
 *                schema:
 *                  properties:
 *                    results:
 *                      type: array
 *                      items:
 *                        type: object
 *                        required:
 *                          - pageId
 *                          - toRevisionId
 *                          - status
 *                        properties:
 *                          pageId:
 *                            type: string
 *                          toRevisionId:
 *                            type: string
 *                          status:
 *                            type: string
 *                            enum: [ok, forbidden, invalid]
 *                          diff:
 *                            type: string
 *                            description: Unified diff string (present only when status is "ok")
 *          400:
 *            description: Invalid request body (too many pairs, invalid ObjectId, malformed body)
 *          401:
 *            description: Not authenticated
 *          403:
 *            description: Insufficient scope (requires read:features:page)
 */

/**
 * Factory function that wires the Revision Diff route handlers.
 *
 * @returns Express RequestHandler array to be spread into router.post().
 */
export const diffRouteHandlersFactory = (crowi: Crowi): RequestHandler[] => {
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

      // userId is always fixed to the authenticated user — never taken from request body.
      const userId = user._id.toString();

      const { pairs, contextLines: contextLinesRaw } = req.body;
      const contextLines = contextLinesRaw ?? DEFAULT_CONTEXT_LINES;

      // Guard: pairs exceeding MAX_PAIRS are rejected before any processing (Req 8.1).
      // express-validator's isArray({ max }) catches this at validation time, but we add
      // an explicit runtime guard as defense-in-depth.
      if (pairs.length > MAX_PAIRS) {
        return res.apiv3Err(
          new ErrorV3(
            `pairs must not exceed ${MAX_PAIRS} items`,
            'too-many-pairs',
          ),
          400,
        );
      }

      try {
        const results = await computeDiffs(user, userId, pairs, contextLines);
        const responseBody: RevisionDiffResponse = { results };
        return res.apiv3(responseBody);
      } catch (err) {
        logger.error('Error in POST /revisions/diff', err);
        return res.apiv3Err(
          new ErrorV3('Failed to compute diffs', 'failed-to-compute-diffs'),
          500,
        );
      }
    },
  ];
};

/**
 * Fetch accessible pages and revisions for the given pairs, then compute
 * per-pair diff results.
 *
 * Pipeline:
 *   1. Collect all unique pageIds and revisionIds from pairs.
 *   2. Page.findByIdsAndViewer(pageIds, user) → accessible page IDs set.
 *   3. Revision.find({ _id: { $in: revisionIds } }) → revision map (id → RevisionDoc).
 *   4. For each pair: computeDiffForPair(pair, accessiblePageIds, revisionMap, contextLines).
 *   5. Return results array in the same order as the input pairs.
 */
async function computeDiffs(
  user: IUserHasId,
  _userId: string,
  pairs: RevisionDiffPairInput[],
  contextLines: number,
) {
  // Collect unique pageIds and revisionIds for bulk queries.
  const pageIds: Types.ObjectId[] = [];
  const revisionIds: Types.ObjectId[] = [];

  for (const pair of pairs) {
    pageIds.push(new Types.ObjectId(pair.pageId));
    revisionIds.push(new Types.ObjectId(pair.toRevisionId));
    if (pair.fromRevisionId != null) {
      revisionIds.push(new Types.ObjectId(pair.fromRevisionId));
    }
  }

  // Deduplicate to avoid redundant queries.
  const uniquePageIds = [
    ...new Map(pageIds.map((id) => [id.toString(), id])).values(),
  ];
  const uniqueRevisionIds = [
    ...new Map(revisionIds.map((id) => [id.toString(), id])).values(),
  ];

  // Bulk query 1: determine which pages the authenticated user can access.
  const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
    'Page',
  );
  const accessiblePages: HydratedDocument<PageDocument>[] =
    await Page.findByIdsAndViewer(uniquePageIds, user, null);
  const accessiblePageIds = new Set(
    accessiblePages.map((p) => p._id.toString()),
  );

  // Bulk query 2: fetch revision documents needed for diff computation.
  const revisionDocs: RevisionDoc[] = await Revision.find(
    { _id: { $in: uniqueRevisionIds } },
    { _id: 1, pageId: 1, body: 1 },
  ).lean();
  const revisionMap = new Map<string, RevisionDoc>(
    revisionDocs.map((r) => [r._id.toString(), r]),
  );

  // Compute per-pair results in order.
  return pairs.map((pair) =>
    computeDiffForPair(pair, accessiblePageIds, revisionMap, contextLines),
  );
}
