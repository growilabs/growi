import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { RequestHandler } from 'express';
import { body, type ValidationChain } from 'express-validator';

import type Crowi from '~/server/crowi';
import {
  type AccessTokenParserReq,
  accessTokenParser,
} from '~/server/middlewares/access-token-parser';
import { extractAccessToken } from '~/server/middlewares/access-token-parser/extract-access-token';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import { excludeReadOnlyUser } from '~/server/middlewares/exclude-read-only-user';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

import type { ApplyTrigger, ReviewChannel } from '../../interfaces';
import type { ServiceError } from '../services/change-proposal-service-types';
import type { ReviewerActionError } from '../services/reviewer-actions';
import { proposalNotFound } from './get-proposal';

// Bounds the request body; a proposal with more operations is approved or reverted as a whole.
export const MAX_OPERATION_KEYS = 1000;

// Order per rules/activity-recording.md: authz before addActivity, validators after it.
export const writeAccessChain = (crowi: Crowi): RequestHandler[] => [
  accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }),
  loginRequiredFactory(crowi),
  excludeReadOnlyUser,
  generateAddActivityMiddleware(),
];

// isString() first rejects objects such as { $ne: null } before any other check.
export const operationKeysValidator = (
  presence: 'required' | 'optional',
): ValidationChain[] => {
  const list = body('operationKeys');
  return [
    (presence === 'optional' ? list.optional() : list)
      .isArray({ min: 1, max: MAX_OPERATION_KEYS })
      .withMessage(
        `operationKeys must be an array of 1 to ${MAX_OPERATION_KEYS} keys`,
      ),
    body('operationKeys.*')
      .isString()
      .bail()
      .isLength({ min: 1, max: 100 })
      .withMessage('operationKeys must hold operation keys'),
  ];
};

/**
 * The service records CHANGE_PROPOSAL_APPROVE on this request's activity when the
 * request approved something, and CHANGE_PROPOSAL_REVERT when a revert applied
 * something. Otherwise the activity stays unsettled and the finalizer drops it.
 */
export const requestTrigger = (res: ApiV3Response): ApplyTrigger => {
  const activityId: unknown = res.locals.activity?._id;
  // addActivity is best-effort; without its id the applier mints its own activity.
  return typeof activityId === 'string'
    ? { kind: 'request', activityId }
    : { kind: 'background' };
};

// An access token marks a call from outside the UI.
export const detectChannel = (req: AccessTokenParserReq): ReviewChannel =>
  extractAccessToken(req) == null ? 'ui' : 'api';

// Every refusal a reviewer action words for its caller; the satisfies clause
// fails the type check when a new ReviewerActionError has no answer here.
const BAD_REQUEST_OF = {
  'comment-too-long': {
    message: 'The comment is too long',
    code: 'comment_too_long',
  },
  'requester-cannot-review': {
    message:
      'The requester cannot reject or abstain from their own change proposal',
    code: 'requester_cannot_review',
  },
  'reviewer-not-found': {
    message: 'A reviewer does not exist',
    code: 'reviewer_not_found',
  },
  'too-many-reviewers': {
    message: 'The change proposal would have too many reviewers',
    code: 'too_many_reviewers',
  },
  'reviewers-disabled': {
    message: 'Reviewers cannot be added on this wiki',
    code: 'reviewers_disabled',
  },
  'invalid-request': {
    message: 'The request is malformed',
    code: 'invalid_request',
  },
} as const satisfies Record<
  Exclude<ReviewerActionError, 'not-found' | 'not-open' | 'user-not-allowed'>,
  { message: string; code: string }
>;

export const respondWithServiceError = (
  res: ApiV3Response,
  error: { readonly code: ServiceError['code'] | ReviewerActionError },
): unknown => {
  switch (error.code) {
    case 'not-found':
      return res.apiv3Err(proposalNotFound(), 404);
    case 'not-open':
      return res.apiv3Err(
        new ErrorV3('Change proposal is no longer open', 'not_open'),
        409,
      );
    case 'user-not-allowed':
      return res.apiv3Err(
        new ErrorV3('This user may not change proposals', 'user_not_allowed'),
        403,
      );
    case 'comment-too-long':
    case 'requester-cannot-review':
    case 'reviewer-not-found':
    case 'too-many-reviewers':
    case 'reviewers-disabled':
    case 'invalid-request':
      return res.apiv3Err(
        new ErrorV3(
          BAD_REQUEST_OF[error.code].message,
          BAD_REQUEST_OF[error.code].code,
        ),
        400,
      );
    default:
      // Codes only createProposal returns; no route here creates a proposal.
      return res.apiv3Err(
        new ErrorV3('Unexpected change proposal error', 'unexpected_error'),
        500,
      );
  }
};
