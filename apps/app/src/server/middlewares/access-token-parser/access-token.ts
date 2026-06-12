import type { IUserHasId, Scope } from '@growi/core/dist/interfaces';
import type { AccessTokenParserReq } from '@growi/core/dist/interfaces/server';
import { serializeUserSecurely } from '@growi/core/dist/models/serializers';
import type { Response } from 'express';

import { extractAccessToken } from '~/server/middlewares/access-token-parser/extract-access-token';
import { AccessToken } from '~/server/models/access-token';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:middleware:access-token-parser:access-token',
);

export const parserForAccessToken = (scopes: Scope[]) => {
  return async (req: AccessTokenParserReq, res: Response): Promise<void> => {
    const accessToken = extractAccessToken(req);
    if (accessToken == null) {
      return;
    }
    if (scopes == null || scopes.length === 0) {
      logger.debug('scopes is empty');
      return;
    }

    // check the access token is valid
    const userId = await AccessToken.findUserIdByToken(accessToken, scopes);
    if (userId == null) {
      logger.debug('The access token is invalid');
      return;
    }

    // check the user is valid
    const { user: userByAccessToken }: { user: IUserHasId } =
      await userId.populate('user');
    if (userByAccessToken == null) {
      logger.debug("The access token's associated user is invalid");
      return;
    }

    if (userByAccessToken.readOnly) {
      logger.debug("The access token's associated user is read-only");
      return;
    }

    // transforming attributes
    req.user = serializeUserSecurely(userByAccessToken);
    if (req.user == null) {
      return;
    }

    logger.debug('Access token parsed.');
    return;
  };
};
