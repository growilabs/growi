import type { IUser, IUserHasId } from '@growi/core/dist/interfaces';
import type { AccessTokenParserReq } from '@growi/core/dist/interfaces/server';
import { serializeUserSecurely } from '@growi/core/dist/models/serializers';
import type { Response } from 'express';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { extractAccessToken } from '~/server/middlewares/access-token-parser/extract-access-token.js';
import loggerFactory from '~/utils/logger/index.js';

const logger = loggerFactory('growi:middleware:access-token-parser:api-token');

export const parserForApiToken = async (
  req: AccessTokenParserReq,
  res: Response,
): Promise<void> => {
  const accessToken = extractAccessToken(req);
  if (accessToken == null) {
    return;
  }

  logger.debug(
    { accessToken: `${accessToken.slice(0, 4)}...${accessToken.slice(-4)}` },
    'accessToken is',
  );

  const User = mongoose.model<HydratedDocument<IUser>, { findUserByApiToken }>(
    'User',
  );
  const userByApiToken: IUserHasId = await User.findUserByApiToken(accessToken);

  if (userByApiToken == null) {
    return;
  }

  req.user = serializeUserSecurely(userByApiToken);
  if (req.user == null) {
    return;
  }

  logger.debug('Access token parsed.');
  return;
};
