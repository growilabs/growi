import assert from 'node:assert';
import { ErrorV3 } from '@growi/core/dist/models';
import type { RequestHandler } from 'express';

import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import type { ChangeProposalView } from '../../interfaces';
import {
  type AuthenticatedRequest,
  type GetChangeProposalService,
  readAccessChain,
} from './read-access';

const logger = loggerFactory(
  'growi:features:change-proposal:routes:get-proposal',
);

type Req = AuthenticatedRequest<Record<string, string>, unknown, unknown>;

// Missing, malformed and invisible all share this body (rules/page-write-action-403-404.md).
export const proposalNotFound = (): ErrorV3 =>
  new ErrorV3('Change proposal is not found', 'notfound');

/**
 * @swagger
 *
 *    /change-proposals/{id}:
 *      get:
 *        tags: [ChangeProposals]
 *        summary: Get a change proposal as the caller may see it
 *        description: >
 *          Returns only the operations on pages the caller may view; a viewer other than
 *          the requester gets no proposed bodies, no requester state and no pending
 *          operations. A missing, malformed or entirely invisible proposal gets one
 *          identical 404. Requires the `read:features:page` scope.
 *        parameters:
 *          - name: id
 *            in: path
 *            required: true
 *            schema:
 *              type: string
 *        responses:
 *          200:
 *            description: The proposal
 *            content:
 *              application/json:
 *                schema:
 *                  type: object
 *                  properties:
 *                    proposal:
 *                      type: object
 *          403:
 *            description: Not authenticated or insufficient scope
 *          404:
 *            description: Not found (code notfound)
 */
export const getProposalRouteHandlersFactory = (
  crowi: Crowi,
  getService: GetChangeProposalService,
): RequestHandler[] => [
  ...readAccessChain(crowi),
  // No id validator: a malformed id must look exactly like a missing one.
  async (req: Req, res: ApiV3Response) => {
    const { user } = req;
    assert(user != null, 'ensured by loginRequired');
    try {
      const result = await getService().getForViewer(req.params.id, user);
      if (!result.ok) {
        return res.apiv3Err(proposalNotFound(), 404);
      }
      const proposal: ChangeProposalView = result.value;
      return res.apiv3({ proposal });
    } catch (err) {
      logger.error({ err }, 'Failed to get a change proposal');
      return res.apiv3Err(
        new ErrorV3('Failed to get the change proposal', 'get-failed'),
        500,
      );
    }
  },
];
