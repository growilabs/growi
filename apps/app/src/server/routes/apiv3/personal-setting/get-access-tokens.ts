import type { IUserHasId } from '@growi/core/dist/interfaces';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import { excludeReadOnlyUser } from '~/server/middlewares/exclude-read-only-user';
import { AccessToken } from '~/server/models/access-token';
import loggerFactory from '~/utils/logger';

import type { ApiV3Response } from '../interfaces/apiv3-response';

const logger = loggerFactory(
  'growi:routes:apiv3:personal-setting:get-access-tokens',
);

interface GetAccessTokenRequest
  extends Request<undefined, ApiV3Response, undefined> {
  user: IUserHasId;
}

type GetAccessTokenHandlerFactory = (crowi: Crowi) => RequestHandler[];

export const getAccessTokenHandlerFactory: GetAccessTokenHandlerFactory = (
  crowi,
) => {
  const loginRequiredStrictly = require('../../../middlewares/login-required')(
    crowi,
  );
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
