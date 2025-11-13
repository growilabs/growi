import type {
  IUserHasId, Scope,
} from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { body } from 'express-validator';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import { excludeReadOnlyUser } from '~/server/middlewares/exclude-read-only-user';
import { AccessToken } from '~/server/models/access-token';
import { isValidScope } from '~/server/util/scope-utils';
import loggerFactory from '~/utils/logger';

import { apiV3FormValidator } from '../../../middlewares/apiv3-form-validator';
import type { ApiV3Response } from '../interfaces/apiv3-response';

const logger = loggerFactory('growi:routes:apiv3:personal-setting:generate-access-tokens');

type ReqBody = {
  expiredAt: Date,
  description?: string,
  scopes?: Scope[],
}

interface GenerateAccessTokenRequest extends Request<undefined, ApiV3Response, ReqBody> {
  user: IUserHasId,
}

type GenerateAccessTokenHandlerFactory = (crowi: Crowi) => RequestHandler[];

const validator = [
  body('expiredAt')
    .exists()
    .withMessage('expiredAt is required')
    .custom((value) => {
      const expiredAt = new Date(value);
      const now = new Date();

      // Check if date is valid
      if (Number.isNaN(expiredAt.getTime())) {
        throw new Error('Invalid date format');
      }

      // Check if date is in the future
      if (expiredAt < now) {
        throw new Error('Expiration date must be in the future');
      }

      return true;
    }),

  body('description')
    .optional()
    .isString()
    .withMessage('description must be a string')
    .isLength({ max: 200 })
    .withMessage('description must be less than or equal to 200 characters'),

  body('scopes')
    .optional()
    .isArray()
    .withMessage('scope must be an array')
    .custom((scopes: Scope[]) => {
      scopes.forEach((scope) => {
        if (!isValidScope(scope)) {
          throw new Error(`Invalid scope: ${scope}}`);
        }
      });
      return true;
    })
    .withMessage('Invalid scope'),
];

export const generateAccessTokenHandlerFactory: GenerateAccessTokenHandlerFactory = (crowi) => {

  const loginRequiredStrictly = require('../../../middlewares/login-required')(crowi);
  const activityEvent = crowi.event('activity');
  const addActivity = generateAddActivityMiddleware();

  return [
    loginRequiredStrictly,
    excludeReadOnlyUser,
    addActivity,
    validator,
    apiV3FormValidator,
    async(req: GenerateAccessTokenRequest, res: ApiV3Response) => {

      const { user, body } = req;
      const { expiredAt, description, scopes } = body;

      try {
        const tokenData = await AccessToken.generateToken(user._id, expiredAt, scopes, description);

        const parameters = { action: SupportedAction.ACTION_USER_ACCESS_TOKEN_CREATE };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3(tokenData);
      }
      catch (err) {
        logger.error(err);
        return res.apiv3Err(new ErrorV3(err.toString(), 'generate-access-token-failed'));
      }
    },
  ];
};
