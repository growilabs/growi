import type { IUserHasId } from '@growi/core/dist/interfaces';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';

import type Crowi from '~/server/crowi/index.js';
import { accessTokenParser } from '~/server/middlewares/access-token-parser/index.js';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity.js';
import { excludeReadOnlyUser } from '~/server/middlewares/exclude-read-only-user.js';
import loginRequiredFactory from '~/server/middlewares/login-required.js';
import { AccessToken } from '~/server/models/access-token.js';
import loggerFactory from '~/utils/logger/index.js';

import type { ApiV3Response } from '../interfaces/apiv3-response.js';

const logger = loggerFactory(
  'growi:routes:apiv3:personal-setting:get-access-tokens',
);

interface GetAccessTokenRequest
  extends Request<Record<string, string>, ApiV3Response, undefined> {
  user: IUserHasId;
}

export const getAccessTokenHandlerFactory = (
  crowi: Crowi,
): RequestHandler[] => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);
  const addActivity = generateAddActivityMiddleware();

  return [
    accessTokenParser([SCOPE.READ.USER_SETTINGS.API.ACCESS_TOKEN]),
    loginRequiredStrictly,
    excludeReadOnlyUser,
    addActivity,
    async (req: GetAccessTokenRequest, res: ApiV3Response) => {
      const { user } = req;

      try {
        const accessTokens = await AccessToken.findTokenByUserId(user._id);
        return res.apiv3({ accessTokens });
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(
          new ErrorV3(err.toString(), 'colud_not_get_access_token'),
        );
      }
    },
  ];
};
