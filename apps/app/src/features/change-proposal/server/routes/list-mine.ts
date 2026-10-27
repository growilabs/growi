import assert from 'node:assert';
import { ErrorV3 } from '@growi/core/dist/models';
import type { RequestHandler } from 'express';
import { query } from 'express-validator';

import type Crowi from '~/server/crowi';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import { limitValidator, toLimit } from './list-query-params';
import {
  type AuthenticatedRequest,
  type GetChangeProposalService,
  readAccessChain,
} from './read-access';

const logger = loggerFactory('growi:features:change-proposal:routes:list-mine');

// Bounds the skip a single request can make the database perform.
const MAX_PAGE = 10000;

type Req = AuthenticatedRequest<
  Record<string, string>,
  unknown,
  { page?: string; limit?: string }
>;

const validator = [
  query('page')
    .optional()
    .isString()
    .bail()
    .isInt({ min: 1, max: MAX_PAGE })
    .withMessage(`page must be an integer between 1 and ${MAX_PAGE}`),
  limitValidator(),
];

/**
 * @swagger
 *
 *    /change-proposals/mine:
 *      get:
 *        tags: [ChangeProposals]
 *        summary: List the caller's own change proposals, newest first
 *        description: Requires the `read:features:page` scope.
 *        parameters:
 *          - name: page
 *            in: query
 *            schema:
 *              type: integer
 *              minimum: 1
 *              maximum: 10000
 *              default: 1
 *          - name: limit
 *            in: query
 *            schema:
 *              type: integer
 *              minimum: 1
 *              maximum: 50
 *              default: 20
 *        responses:
 *          200:
 *            description: One page of summaries
 *            content:
 *              application/json:
 *                schema:
 *                  type: object
 *                  properties:
 *                    items:
 *                      type: array
 *                      items:
 *                        type: object
 *                    hasNext:
 *                      type: boolean
 *          400:
 *            description: Invalid page or limit
 *          403:
 *            description: Not authenticated or insufficient scope
 */
export const listMineRouteHandlersFactory = (
  crowi: Crowi,
  getService: GetChangeProposalService,
): RequestHandler[] => [
  ...readAccessChain(crowi),
  ...validator,
  apiV3FormValidator,
  async (req: Req, res: ApiV3Response) => {
    const { user } = req;
    assert(user != null, 'ensured by loginRequired');
    try {
      const page = req.query.page == null ? 1 : Number(req.query.page);
      const { items, hasNext } = await getService().listMine(
        user,
        page,
        toLimit(req.query.limit),
      );
      return res.apiv3({ items, hasNext });
    } catch (err) {
      logger.error({ err }, 'Failed to list own change proposals');
      return res.apiv3Err(
        new ErrorV3('Failed to list change proposals', 'list-failed'),
        500,
      );
    }
  },
];
