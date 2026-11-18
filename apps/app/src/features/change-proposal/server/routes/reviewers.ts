import assert from 'node:assert';
import { ErrorV3 } from '@growi/core/dist/models';
import type { RequestHandler } from 'express';

import type Crowi from '~/server/crowi';
import type { AccessTokenParserReq } from '~/server/middlewares/access-token-parser';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import type { ReviewerInput } from '../../interfaces';
import type {
  AuthenticatedRequest,
  GetChangeProposalService,
} from './read-access';
import {
  detectChannel,
  requestTrigger,
  respondWithServiceError,
  writeAccessChain,
} from './write-access';

const logger = loggerFactory('growi:features:change-proposal:routes:reviewers');

// What a well-formed body holds. The service checks the shape of the lists itself
// (an AI tool calls it without this route), so the route only chooses the action.
type Req = AuthenticatedRequest<
  Record<string, string>,
  { readonly add?: ReviewerInput[]; readonly remove?: ReviewerInput[] },
  AccessTokenParserReq['query']
>;

/**
 * @swagger
 *
 *    /change-proposals/{id}/reviewers:
 *      patch:
 *        tags: [ChangeProposals]
 *        summary: Add or remove reviewers of a change proposal
 *        description: >
 *          One request either adds or removes reviewers, so the body holds exactly one of
 *          add and remove. A user who is not active, or a group that does not exist, is
 *          answered with code reviewer_not_found. A body of the wrong shape gets code
 *          invalid_request. Requires the `write:features:page` scope.
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
 *                properties:
 *                  add:
 *                    type: array
 *                    items:
 *                      type: object
 *                      required: [kind, id]
 *                      properties:
 *                        kind:
 *                          type: string
 *                          enum: [user, user-group, external-user-group]
 *                        id:
 *                          type: string
 *                          description: User ID or group ID
 *                  remove:
 *                    type: array
 *                    items:
 *                      type: object
 *                      required: [kind, id]
 *                      properties:
 *                        kind:
 *                          type: string
 *                          enum: [user, user-group, external-user-group]
 *                        id:
 *                          type: string
 *                          description: User ID or group ID
 *        responses:
 *          204:
 *            description: The reviewers were changed
 *          400:
 *            description: Malformed body (code invalid_request), an unknown or inactive reviewer (code reviewer_not_found), too many reviewers (code too_many_reviewers), or reviewers are disabled on this wiki (code reviewers_disabled)
 *          403:
 *            description: Not authenticated, insufficient scope, or a user who may not change proposals (code user_not_allowed)
 *          404:
 *            description: The proposal does not exist, or the caller may not see it (code notfound)
 *          409:
 *            description: The proposal is no longer open (code not_open)
 */
export const reviewersRouteHandlersFactory = (
  crowi: Crowi,
  getService: GetChangeProposalService,
): RequestHandler[] => [
  ...writeAccessChain(crowi),
  async (req: Req, res: ApiV3Response) => {
    const { user } = req;
    assert(user != null, 'ensured by loginRequired');
    const { add, remove } = req.body;
    const inputs = add ?? remove;
    // One request is one activity, so it either adds or removes.
    if (inputs == null || (add != null && remove != null)) {
      return respondWithServiceError(res, { code: 'invalid-request' });
    }
    try {
      const actor = {
        user,
        channel: detectChannel(req),
        trigger: requestTrigger(res),
      };
      // The service settles the activity before it returns — see rules/activity-recording.md.
      const result =
        add != null
          ? await getService().addReviewers(req.params.id, actor, inputs)
          : await getService().removeReviewers(req.params.id, actor, inputs);
      if (!result.ok) {
        return respondWithServiceError(res, result.error);
      }
      return res.status(204).end();
    } catch (err) {
      logger.error({ err }, 'Failed to change the reviewers of a proposal');
      return res.apiv3Err(
        new ErrorV3('Failed to change the reviewers', 'reviewers-failed'),
        500,
      );
    }
  },
];
