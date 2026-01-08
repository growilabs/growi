import type { IUserHasId } from '@growi/core/dist/interfaces';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import { excludeReadOnlyUser } from '~/server/middlewares/exclude-read-only-user';
import { AccessToken } from '~/server/models/access-token';
import loggerFactory from '~/utils/logger';

import type { ApiV3Response } from '../interfaces/apiv3-response';

const logger = loggerFactory(
  'growi:routes:apiv3:personal-setting:generate-access-tokens',
);

interface DeleteAllAccessTokensRequest
  extends Request<undefined, ApiV3Response, undefined> {
  user: IUserHasId;
}

type DeleteAllAccessTokensHandlersFactory = (crowi: Crowi) => RequestHandler[];

export const deleteAllAccessTokensHandlersFactory: DeleteAllAccessTokensHandlersFactory =
  (crowi) => {
    const loginRequiredStrictly =
      require('../../../middlewares/login-required')(crowi);
    const addActivity = generateAddActivityMiddleware();
    const activityEvent = crowi.event('activity');

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
