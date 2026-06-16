import type { IUserHasId } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';

import loggerFactory from '~/utils/logger';

import type Crowi from '../../../crowi';
import { accessTokenParser } from '../../../middlewares/access-token-parser';
import loginRequiredFactory from '../../../middlewares/login-required';
import type { ApiV3Response } from '../interfaces/apiv3-response';

const logger = loggerFactory('growi:routes:apiv3:user:get-related-groups');

interface Req extends Request {
  user: IUserHasId;
}

export const getRelatedGroupsHandlerFactory = (
  crowi: Crowi,
): RequestHandler[] => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);

  return [
    accessTokenParser([SCOPE.READ.USER_SETTINGS.INFO], { acceptLegacy: true }),
    loginRequiredStrictly,
    async (req: Req, res: ApiV3Response) => {
      try {
        const relatedGroups =
          await crowi.pageGrantService?.getUserRelatedGroups(req.user);
        return res.apiv3({ relatedGroups });
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(
          new ErrorV3('Error occurred while getting user related groups'),
        );
      }
    },
  ];
};
