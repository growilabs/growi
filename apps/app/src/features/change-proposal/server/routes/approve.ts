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
  requestTrigger,
  respondWithServiceError,
  writeAccessChain,
} from './write-access';

const logger = loggerFactory('growi:features:change-proposal:routes:approve');

type Req = AuthenticatedRequest<
  Record<string, string>,
  { operationKeys?: string[] },
  unknown
>;

/**
 * @swagger
 *
 *    /change-proposals/{id}/approve:
 *      post:
 *        tags: [ChangeProposals]
 *        summary: Approve and apply pending operations of the caller's change proposal
 *        description: >
 *          Approves the chosen pending operations (each chosen key also approves the other
 *          pending operations on the same page), or every pending operation when
 *          operationKeys is omitted, and applies them before responding. "in-progress"
 *          means another run holds the apply; it applies the approved operations.
 *          Only the requester may approve; anyone else gets the same 404 as a missing id.
 *          Requires the `write:features:page` scope.
 *        parameters:
 *          - name: id
 *            in: path
 *            required: true
 *            schema:
 *              type: string
 *        requestBody:
 *          content:
 *            application/json:
 *              schema:
 *                type: object
 *                properties:
 *                  operationKeys:
 *                    type: array
 *                    minItems: 1
 *                    maxItems: 1000
 *                    items:
 *                      type: string
 *        responses:
 *          200:
 *            description: The apply result
 *            content:
 *              application/json:
 *                schema:
 *                  type: object
 *                  properties:
 *                    result:
 *                      type: object
 *                      properties:
 *                        type:
 *                          type: string
 *                          enum: [done, in-progress]
 *                        results:
 *                          type: array
 *                          items:
 *                            type: object
 *                            properties:
 *                              key:
 *                                type: string
 *                              status:
 *                                type: string
 *                              reason:
 *                                type: string
 *          400:
 *            description: Invalid request body, or a read-only user
 *          403:
 *            description: Not authenticated or insufficient scope
 *          404:
 *            description: The proposal does not exist or the caller is not its requester (code notfound)
 *          409:
 *            description: The proposal is no longer open (code not_open)
 */
export const approveRouteHandlersFactory = (
  crowi: Crowi,
  getService: GetChangeProposalService,
): RequestHandler[] => [
  ...writeAccessChain(crowi),
  ...operationKeysValidator('optional'),
  apiV3FormValidator,
  async (req: Req, res: ApiV3Response) => {
    const { user } = req;
    assert(user != null, 'ensured by loginRequired');
    try {
      // The service settles the activity before it returns — see rules/activity-recording.md.
      const result = await getService().approve(
        req.params.id,
        user,
        req.body.operationKeys ?? 'all',
        requestTrigger(res),
      );
      if (!result.ok) {
        return respondWithServiceError(res, result.error);
      }
      return res.apiv3({ result: result.value });
    } catch (err) {
      logger.error({ err }, 'Failed to approve a change proposal');
      return res.apiv3Err(
        new ErrorV3('Failed to approve the change proposal', 'approve-failed'),
        500,
      );
    }
  },
];
