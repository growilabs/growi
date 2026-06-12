import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { query } from 'express-validator';

import { SupportedAction } from '~/interfaces/activity.js';
import type Crowi from '~/server/crowi/index.js';
import { accessTokenParser } from '~/server/middlewares/access-token-parser/index.js';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity.js';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator.js';
import { excludeReadOnlyUser } from '~/server/middlewares/exclude-read-only-user.js';
import loginRequiredFactory from '~/server/middlewares/login-required.js';
import { AccessToken } from '~/server/models/access-token.js';
import loggerFactory from '~/utils/logger/index.js';

import type { ApiV3Response } from '../interfaces/apiv3-response.js';

const logger = loggerFactory(
  'growi:routes:apiv3:personal-setting:generate-access-tokens',
);

type ReqQuery = {
  tokenId: string;
};

type DeleteAccessTokenRequest = Request<
  Record<string, string>,
  ApiV3Response,
  undefined,
  ReqQuery
>;

const validator = [
  query('tokenId')
    .exists()
    .withMessage('tokenId is required')
    .isString()
    .withMessage('tokenId must be a string'),
];

export const deleteAccessTokenHandlersFactory = (
  crowi: Crowi,
): RequestHandler[] => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);
  const addActivity = generateAddActivityMiddleware();
  const activityEvent = crowi.events.activity;

  return [
    accessTokenParser([SCOPE.WRITE.USER_SETTINGS.API.ACCESS_TOKEN]),
    loginRequiredStrictly,
    excludeReadOnlyUser,
    addActivity,
    ...validator,
    apiV3FormValidator,
    async (req: DeleteAccessTokenRequest, res: ApiV3Response) => {
      const { query } = req;
      const { tokenId } = query;

      try {
        await AccessToken.deleteTokenById(tokenId);

        const parameters = {
          action: SupportedAction.ACTION_USER_ACCESS_TOKEN_DELETE,
        };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3({});
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(
          new ErrorV3(err.toString(), 'delete-access-token-failed'),
        );
      }
    },
  ];
};
