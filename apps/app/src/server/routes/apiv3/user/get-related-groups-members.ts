import type { IUserHasId } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import loginRequiredFactory from '~/server/middlewares/login-required';
import { fetchActiveMembersByGroup } from '~/server/service/user-group/fetch-active-members-by-group';
import loggerFactory from '~/utils/logger';

import type { ApiV3Response } from '../interfaces/apiv3-response';

const logger = loggerFactory(
  'growi:routes:apiv3:user:get-related-groups-members',
);

interface Req extends Request {
  user: IUserHasId;
}

export const getRelatedGroupsMembersHandlerFactory = (
  crowi: Crowi,
): RequestHandler[] => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);

  return [
    accessTokenParser([SCOPE.READ.FEATURES.USER_GROUP], { acceptLegacy: true }),
    loginRequiredStrictly,
    async (req: Req, res: ApiV3Response) => {
      try {
        const groups = await crowi.pageGrantService?.getUserRelatedGroups(
          req.user,
        );
        const membersByGroupId = await fetchActiveMembersByGroup(groups ?? []);
        return res.apiv3({ membersByGroupId });
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(
          new ErrorV3('Error occurred while getting related groups members'),
        );
      }
    },
  ];
};
