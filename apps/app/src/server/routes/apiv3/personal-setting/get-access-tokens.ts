import type { IUserHasId } from '@growi/core/dist/interfaces';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';

import loggerFactory from '~/utils/logger';

import type Crowi from '../../../crowi';
import { accessTokenParser } from '../../../middlewares/access-token-parser';
import { generateAddActivityMiddleware } from '../../../middlewares/add-activity';
import { excludeReadOnlyUser } from '../../../middlewares/exclude-read-only-user';
import loginRequiredFactory from '../../../middlewares/login-required';
import { AccessToken } from '../../../models/access-token';
import type { ApiV3Response } from '../interfaces/apiv3-response';

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
