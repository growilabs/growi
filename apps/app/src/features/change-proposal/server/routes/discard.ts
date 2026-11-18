import assert from 'node:assert';
import { ErrorV3 } from '@growi/core/dist/models';
import type { RequestHandler } from 'express';

import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import type {
  AuthenticatedRequest,
  GetChangeProposalService,
} from './read-access';
import { respondWithServiceError, writeAccessChain } from './write-access';

const logger = loggerFactory('growi:features:change-proposal:routes:discard');

type Req = AuthenticatedRequest<Record<string, string>, unknown, unknown>;

/**
 * @swagger
 *
 *    /change-proposals/{id}/discard:
 *      post:
 *        tags: [ChangeProposals]
 *        summary: Discard the caller's change proposal
 *        description: >
 *          Skips every pending operation and closes the proposal as discarded. Applied
 *          operations stay applied. Only the requester may discard; anyone else gets
 *          the same 404 as a missing id. Requires the `write:features:page` scope.
 *        parameters:
 *          - name: id
 *            in: path
 *            required: true
 *            schema:
 *              type: string
 *        responses:
 *          200:
 *            description: Discarded
 *            content:
 *              application/json:
 *                schema:
 *                  type: object
 *          400:
 *            description: A read-only user
 *          403:
 *            description: Not authenticated or insufficient scope
 *          404:
 *            description: The proposal does not exist or the caller is not its requester (code notfound)
 *          409:
 *            description: The proposal is no longer open (code not_open)
 */
export const discardRouteHandlersFactory = (
  crowi: Crowi,
  getService: GetChangeProposalService,
): RequestHandler[] => [
  ...writeAccessChain(crowi),
  async (req: Req, res: ApiV3Response) => {
    const { user } = req;
    assert(user != null, 'ensured by loginRequired');
    try {
      const result = await getService().discard(req.params.id, user);
      if (!result.ok) {
        return respondWithServiceError(res, result.error);
      }
      return res.apiv3({});
    } catch (err) {
      logger.error({ err }, 'Failed to discard a change proposal');
      return res.apiv3Err(
        new ErrorV3('Failed to discard the change proposal', 'discard-failed'),
        500,
      );
    }
  },
];
