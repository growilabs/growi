import type { IUserHasId } from '@growi/core/dist/interfaces';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';

import { SupportedAction } from '~/interfaces/activity';
import loggerFactory from '~/utils/logger';

import type Crowi from '../../../crowi';
import { accessTokenParser } from '../../../middlewares/access-token-parser';
import { generateAddActivityMiddleware } from '../../../middlewares/add-activity';
import { excludeReadOnlyUser } from '../../../middlewares/exclude-read-only-user';
import loginRequiredFactory from '../../../middlewares/login-required';
import { AccessToken } from '../../../models/access-token';
import type { ApiV3Response } from '../interfaces/apiv3-response';

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
