import assert from 'node:assert';
import { ErrorV3 } from '@growi/core/dist/models';
import type { RequestHandler } from 'express';
import { body, type ValidationChain } from 'express-validator';

import type Crowi from '~/server/crowi';
import type { AccessTokenParserReq } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import type { ReviewerInput } from '../../interfaces';
import { REVIEWER_KINDS } from '../services/normalize-create-input';
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

// What reviewersValidator guarantees: one request is one activity, so it either adds or removes.
type ReviewersBody =
  | { readonly add: ReviewerInput[]; readonly remove?: undefined }
  | { readonly add?: undefined; readonly remove: ReviewerInput[] };

type Req = AuthenticatedRequest<
  Record<string, string>,
  ReviewersBody,
  AccessTokenParserReq['query']
>;

// isString() before isIn(): isIn() alone accepts ['user'] by checking each element.
const reviewerListValidator = (field: 'add' | 'remove'): ValidationChain[] => [
  body(field)
    .optional()
    .isArray({ min: 1 })
    .withMessage(`${field} must be a non-empty array of reviewers`),
  body(`${field}.*.kind`)
    .isString()
    .bail()
    .isIn(REVIEWER_KINDS)
    .withMessage(`kind must be one of ${REVIEWER_KINDS.join(', ')}`),
  body(`${field}.*.id`).isString().withMessage('id must be a string'),
];

const reviewersValidator: ValidationChain[] = [
  body('add')
    .custom(
      (add: unknown, { req }) =>
        (add === undefined) !== (req.body.remove === undefined),
    )
    .withMessage('Exactly one of add and remove is required'),
  ...reviewerListValidator('add'),
  ...reviewerListValidator('remove'),
];

// The validators check kind and id but let other properties through; keep only what ReviewerInput declares.
const toReviewerInputs = (
  reviewers: readonly ReviewerInput[],
): ReviewerInput[] => reviewers.map(({ kind, id }) => ({ kind, id }));

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
 *          answered with code reviewer_not_found. Requires the `write:features:page` scope.
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
 *                    minItems: 1
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
 *                    minItems: 1
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
 *            description: Invalid request body (code validation_failed), an unknown or inactive reviewer (code reviewer_not_found), too many reviewers (code too_many_reviewers), or reviewers are disabled on this wiki (code reviewers_disabled)
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
  ...reviewersValidator,
  apiV3FormValidator,
  async (req: Req, res: ApiV3Response) => {
    const { user } = req;
    assert(user != null, 'ensured by loginRequired');
    const change = req.body;
    try {
      const actor = {
        user,
        channel: detectChannel(req),
        trigger: requestTrigger(res),
      };
      // The service settles the activity before it returns — see rules/activity-recording.md.
      const result =
        change.add !== undefined
          ? await getService().addReviewers(
              req.params.id,
              actor,
              toReviewerInputs(change.add),
            )
          : await getService().removeReviewers(
              req.params.id,
              actor,
              toReviewerInputs(change.remove),
            );
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
