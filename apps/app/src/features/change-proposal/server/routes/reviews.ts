import assert from 'node:assert';
import { ErrorV3 } from '@growi/core/dist/models';
import type { RequestHandler } from 'express';
import { body, type ValidationChain } from 'express-validator';

import type Crowi from '~/server/crowi';
import type { AccessTokenParserReq } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import type { ReviewKind } from '../../interfaces';
import type { ChangeProposalService } from '../services/change-proposal-service';
import type { ReviewActor } from '../services/reviewer-actions';
import type {
  AuthenticatedRequest,
  GetChangeProposalService,
} from './read-access';
import {
  detectChannel,
  operationKeysValidator,
  requestTrigger,
  respondWithServiceError,
  writeAccessChain,
} from './write-access';

const logger = loggerFactory('growi:features:change-proposal:routes:reviews');

// What reviewValidator guarantees.
type ReviewBody = { readonly comment?: string } & (
  | { readonly kind: 'reject'; readonly operationKeys?: string[] }
  | { readonly kind: 'abstain'; readonly operationKeys: string[] }
);

type Req = AuthenticatedRequest<
  Record<string, string>,
  ReviewBody,
  AccessTokenParserReq['query']
>;

type ReviewOutcome = ReturnType<ChangeProposalService['rejectAll']>;

const REVIEW_KINDS = ['reject', 'abstain'] satisfies readonly ReviewKind[];

// isString() before isIn(): isIn() alone accepts ['reject'] by checking each element.
const reviewValidator: ValidationChain[] = [
  body('kind')
    .isString()
    .bail()
    .isIn(REVIEW_KINDS)
    .withMessage(`kind must be one of ${REVIEW_KINDS.join(', ')}`),
  body('operationKeys')
    .if(body('kind').equals('abstain'))
    .exists()
    .withMessage('abstain needs operationKeys'),
  ...operationKeysValidator('optional'),
  body('comment').optional().isString().withMessage('comment must be a string'),
];

// A rejection without keys rejects the whole proposal; an abstention is always about operations.
const dispatchReview = (
  service: ChangeProposalService,
  proposalId: string,
  actor: ReviewActor,
  review: ReviewBody,
): ReviewOutcome => {
  if (review.kind === 'abstain') {
    return service.abstain(
      proposalId,
      actor,
      review.operationKeys,
      review.comment,
    );
  }
  return review.operationKeys === undefined
    ? service.rejectAll(proposalId, actor, review.comment)
    : service.rejectOperations(
        proposalId,
        actor,
        review.operationKeys,
        review.comment,
      );
};

/**
 * @swagger
 *
 *    /change-proposals/{id}/reviews:
 *      post:
 *        tags: [ChangeProposals]
 *        summary: Reject or abstain from pending operations of a change proposal, as a reviewer
 *        description: >
 *          Records a rejection or an abstention. A rejection without operationKeys rejects
 *          the whole proposal (results is then empty); an abstention always needs
 *          operationKeys. Only pending operations on pages the caller may view are affected.
 *          The requester cannot review their own proposal.
 *          Requires the `write:features:page` scope.
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
 *                required: [kind]
 *                properties:
 *                  kind:
 *                    type: string
 *                    enum: [reject, abstain]
 *                  operationKeys:
 *                    type: array
 *                    minItems: 1
 *                    maxItems: 1000
 *                    items:
 *                      type: string
 *                  comment:
 *                    type: string
 *                    maxLength: 500
 *        responses:
 *          200:
 *            description: The review was recorded
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
 *                          enum: [done]
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
 *                                nullable: true
 *          400:
 *            description: Invalid request body (code validation_failed), a comment over 500 characters (code comment_too_long), or the caller is the requester (code requester_cannot_review)
 *          403:
 *            description: Not authenticated, insufficient scope, or a user who may not change proposals (code user_not_allowed)
 *          404:
 *            description: The proposal does not exist, or the caller is neither its requester nor a reviewer who may view one of its pages (code notfound)
 *          409:
 *            description: The proposal is no longer open (code not_open)
 */
export const reviewsRouteHandlersFactory = (
  crowi: Crowi,
  getService: GetChangeProposalService,
): RequestHandler[] => [
  ...writeAccessChain(crowi),
  ...reviewValidator,
  apiV3FormValidator,
  async (req: Req, res: ApiV3Response) => {
    const { user } = req;
    assert(user != null, 'ensured by loginRequired');
    try {
      // The service settles the activity before it returns — see rules/activity-recording.md.
      const result = await dispatchReview(
        getService(),
        req.params.id,
        { user, channel: detectChannel(req), trigger: requestTrigger(res) },
        req.body,
      );
      if (!result.ok) {
        return respondWithServiceError(res, result.error);
      }
      return res.apiv3({ result: result.value });
    } catch (err) {
      logger.error({ err }, 'Failed to record a review of a change proposal');
      return res.apiv3Err(
        new ErrorV3('Failed to record the review', 'review-failed'),
        500,
      );
    }
  },
];
