import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { RequestHandler } from 'express';
import { body, type ValidationChain } from 'express-validator';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import { excludeReadOnlyUser } from '~/server/middlewares/exclude-read-only-user';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

import type { ApplyTrigger } from '../../interfaces';
import type { ServiceError } from '../services/change-proposal-service-types';
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
 * The service records CHANGE_PROPOSAL_APPLY / _REVERT on this request's activity
 * only when the run applied something. Otherwise the activity stays unsettled and
 * the finalizer drops it: the run that applies the approved operations later
 * records the action itself, and an approval alone has no action to record.
 */
export const requestTrigger = (res: ApiV3Response): ApplyTrigger => {
  const activityId: unknown = res.locals.activity?._id;
  // addActivity is best-effort; without its id the applier mints its own activity.
  return typeof activityId === 'string'
    ? { kind: 'request', activityId }
    : { kind: 'background' };
};

export const respondWithServiceError = (
  res: ApiV3Response,
  error: ServiceError,
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
    default:
      // Codes only createProposal returns; no write route here can produce them.
      return res.apiv3Err(
        new ErrorV3('Unexpected change proposal error', 'unexpected_error'),
        500,
      );
  }
};
