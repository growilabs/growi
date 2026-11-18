import assert from 'node:assert';
import { ErrorV3 } from '@growi/core/dist/models';
import type { RequestHandler } from 'express';
import { query } from 'express-validator';

import type Crowi from '~/server/crowi';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import { isReviewQueueCursor } from '../services/review-queue-query';
import { limitValidator, toLimit } from './list-query-params';
import {
  type AuthenticatedRequest,
  type GetChangeProposalService,
  readAccessChain,
} from './read-access';

const logger = loggerFactory(
  'growi:features:change-proposal:routes:review-queue',
);

type Req = AuthenticatedRequest<
  Record<string, string>,
  unknown,
  { cursor?: string; limit?: string }
>;

const validator = [
  query('cursor')
    .optional()
    .isString()
    .bail()
    .custom((value: string) => isReviewQueueCursor(value))
    .withMessage('cursor is malformed'),
  limitValidator(),
];

/**
 * @swagger
 *
 *    /change-proposals/review-queue:
 *      get:
 *        tags: [ChangeProposals]
 *        summary: List open change proposals waiting for review by the caller
 *        description: >
 *          Lists proposals the caller is a reviewer of that still have pending operations
 *          on pages the caller may view. No total count is returned; continue with
 *          nextCursor. Requires the `read:features:page` scope.
 *        parameters:
 *          - name: cursor
 *            in: query
 *            description: Opaque cursor, a 24-character lowercase hexadecimal string
 *            schema:
 *              type: string
 *          - name: limit
 *            in: query
 *            schema:
 *              type: integer
 *              minimum: 1
 *              maximum: 50
 *              default: 20
 *        responses:
 *          200:
 *            description: Summaries and the cursor to continue from
 *            content:
 *              application/json:
 *                schema:
 *                  type: object
 *                  properties:
 *                    items:
 *                      type: array
 *                      items:
 *                        type: object
 *                    nextCursor:
 *                      type: string
 *                      nullable: true
 *          400:
 *            description: Invalid cursor or limit (code validation_failed)
 *          403:
 *            description: Not authenticated or insufficient scope
 */
export const reviewQueueRouteHandlersFactory = (
  crowi: Crowi,
  getService: GetChangeProposalService,
): RequestHandler[] => {
  return [
    ...readAccessChain(crowi),
    ...validator,
    apiV3FormValidator,
    async (req: Req, res: ApiV3Response) => {
      const { user } = req;
      assert(user != null, 'ensured by loginRequired');
      try {
        const { items, nextCursor } = await getService().listReviewQueue(
          user,
          req.query.cursor ?? null,
          toLimit(req.query.limit),
        );
        return res.apiv3({ items, nextCursor });
      } catch (err) {
        logger.error({ err }, 'Failed to list the review queue');
        return res.apiv3Err(
          new ErrorV3('Failed to list change proposals', 'list-failed'),
          500,
        );
      }
    },
  ];
};
