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

const logger = loggerFactory('growi:features:change-proposal:routes:revert');

type Req = AuthenticatedRequest<
  Record<string, string>,
  { operationKeys?: string[] },
  unknown
>;

/**
 * @swagger
 *
 *    /change-proposals/{id}/revert:
 *      post:
 *        tags: [ChangeProposals]
 *        summary: Revert applied operations of a change proposal
 *        description: >
 *          Reverts the chosen operations, or every applied operation the caller may see
 *          when operationKeys is omitted, by creating and applying a revert proposal
 *          before responding. Anyone who may view the operation's page may revert it.
 *          An operation missing from the result is still being applied by another run;
 *          read the revert proposal for its outcome. A proposal with nothing the caller
 *          may see gets the same 404 as a missing id. Requires the `write:features:page`
 *          scope.
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
 *            description: The revert result
 *            content:
 *              application/json:
 *                schema:
 *                  type: object
 *                  properties:
 *                    result:
 *                      type: object
 *                      properties:
 *                        revertProposalId:
 *                          type: string
 *                          description: Absent when nothing could be reverted
 *                        operations:
 *                          type: array
 *                          items:
 *                            type: object
 *                            properties:
 *                              key:
 *                                type: string
 *                              outcome:
 *                                type: string
 *                                enum: [reverted, revert-refused, skipped]
 *                              reason:
 *                                type: string
 *          400:
 *            description: Invalid request body, or a read-only user
 *          403:
 *            description: Not authenticated, insufficient scope, or a user who may not write
 *          404:
 *            description: The proposal does not exist or holds nothing the caller may see (code notfound)
 */
export const revertRouteHandlersFactory = (
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
      const result = await getService().revert(
        req.params.id,
        user,
        req.body.operationKeys ?? 'all-visible',
        requestTrigger(res),
      );
      if (!result.ok) {
        return respondWithServiceError(res, result.error);
      }
      return res.apiv3({ result: result.value });
    } catch (err) {
      logger.error({ err }, 'Failed to revert a change proposal');
      return res.apiv3Err(
        new ErrorV3('Failed to revert the change proposal', 'revert-failed'),
        500,
      );
    }
  },
];
