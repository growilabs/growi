import type { IUserHasId } from '@growi/core/dist/interfaces';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';

import { SupportedAction } from '~/interfaces/activity.js';
import type Crowi from '~/server/crowi/index.js';
import { accessTokenParser } from '~/server/middlewares/access-token-parser/index.js';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity.js';
import { excludeReadOnlyUser } from '~/server/middlewares/exclude-read-only-user.js';
import loginRequiredFactory from '~/server/middlewares/login-required.js';
import { AccessToken } from '~/server/models/access-token.js';
import loggerFactory from '~/utils/logger/index.js';

import type { ApiV3Response } from '../interfaces/apiv3-response.js';

const logger = loggerFactory(
  'growi:routes:apiv3:personal-setting:generate-access-tokens',
);

interface DeleteAllAccessTokensRequest
  extends Request<Record<string, string>, ApiV3Response, undefined> {
  user: IUserHasId;
}

export const deleteAllAccessTokensHandlersFactory = (
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
    async (req: DeleteAllAccessTokensRequest, res: ApiV3Response) => {
      const { user } = req;

      try {
        await AccessToken.deleteAllTokensByUserId(user._id);

        const parameters = {
          action: SupportedAction.ACTION_USER_ACCESS_TOKEN_DELETE,
        };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3({});
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(
          new ErrorV3(err.toString(), 'delete-all-access-token-failed'),
        );
      }
    },
  ];
};
