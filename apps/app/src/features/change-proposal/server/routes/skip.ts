import assert from 'node:assert';
import { ErrorV3 } from '@growi/core/dist/models';
import type { RequestHandler } from 'express';

import type Crowi from '~/server/crowi';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import type {
  AuthenticatedRequest,
  GetChangeProposalService,
} from './read-access';
import {
  operationKeysValidator,
  respondWithServiceError,
  writeAccessChain,
} from './write-access';

const logger = loggerFactory('growi:features:change-proposal:routes:skip');

type Req = AuthenticatedRequest<
  Record<string, string>,
  { operationKeys: string[] },
  unknown
>;

/**
 * @swagger
 *
 *    /change-proposals/{id}/skip:
 *      post:
 *        tags: [ChangeProposals]
 *        summary: Skip pending operations of the caller's change proposal
 *        description: >
 *          Marks the chosen pending operations as skipped; the proposal settles once
 *          nothing is pending. Only the requester may skip; anyone else gets the same
 *          404 as a missing id. Requires the `write:features:page` scope.
 *        parameters:
 *          - name: id
 *            in: path
 *            required: true
 *            schema:
 *              type: string
 *        requestBody:
 *          required: true
 *          content:
 *            application/json:
 *              schema:
 *                type: object
 *                required:
 *                  - operationKeys
 *                properties:
 *                  operationKeys:
 *                    type: array
 *                    minItems: 1
 *                    maxItems: 1000
 *                    items:
 *                      type: string
 *        responses:
 *          200:
 *            description: Skipped
 *            content:
 *              application/json:
 *                schema:
 *                  type: object
 *          400:
 *            description: Invalid request body, or a read-only user
 *          403:
 *            description: Not authenticated or insufficient scope
 *          404:
 *            description: The proposal does not exist or the caller is not its requester (code notfound)
 *          409:
 *            description: The proposal is no longer open (code not_open)
 */
export const skipRouteHandlersFactory = (
  crowi: Crowi,
  getService: GetChangeProposalService,
): RequestHandler[] => [
  ...writeAccessChain(crowi),
  ...operationKeysValidator('required'),
  apiV3FormValidator,
  async (req: Req, res: ApiV3Response) => {
    const { user } = req;
    assert(user != null, 'ensured by loginRequired');
    try {
      const result = await getService().skip(
        req.params.id,
        user,
        req.body.operationKeys,
      );
      if (!result.ok) {
        return respondWithServiceError(res, result.error);
      }
      return res.apiv3({});
    } catch (err) {
      logger.error({ err }, 'Failed to skip change proposal operations');
      return res.apiv3Err(
        new ErrorV3('Failed to skip the operations', 'skip-failed'),
        500,
      );
    }
  },
];
