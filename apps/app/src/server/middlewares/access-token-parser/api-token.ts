import type { IUser, IUserHasId } from '@growi/core/dist/interfaces';
import { serializeUserSecurely } from '@growi/core/dist/models/serializers';
import type { Response } from 'express';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import loggerFactory from '~/utils/logger';

import { extractBearerToken } from './extract-bearer-token';
import type { AccessTokenParserReq } from './interfaces';

const logger = loggerFactory('growi:middleware:access-token-parser:api-token');

export const parserForApiToken = async (
  req: AccessTokenParserReq,
  res: Response,
): Promise<void> => {
  // Extract token from Authorization header first
  // It is more efficient to call it only once in "AccessTokenParser," which is the caller of the method
  const bearerToken = extractBearerToken(req.headers.authorization);

  // Try all possible token sources in order of priority
  const accessToken =
    bearerToken ?? req.query.access_token ?? req.body.access_token;

  if (accessToken == null || typeof accessToken !== 'string') {
    return;
  }

  logger.debug('accessToken is', accessToken);

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
