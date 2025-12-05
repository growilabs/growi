import type { Scope } from '@growi/core/dist/interfaces';
import type { NextFunction, Response } from 'express';

import loggerFactory from '~/utils/logger';

import { parserForAccessToken } from './access-token';
import { parserForApiToken } from './api-token';
import type { AccessTokenParserReq } from './interfaces';

const logger = loggerFactory('growi:middleware:access-token-parser');

export type AccessTokenParser = (
  scopes?: Scope[],
  opts?: { acceptLegacy: boolean },
) => (
  req: AccessTokenParserReq,
  res: Response,
  next: NextFunction,
) => Promise<void>;

export const accessTokenParser: AccessTokenParser = (scopes, opts) => {
  return async (req, res, next): Promise<void> => {
    if (scopes == null || scopes.length === 0) {
      logger.warn('scopes is empty');
      return next();
    }

    await parserForAccessToken(scopes)(req, res);

    if (opts?.acceptLegacy) {
      await parserForApiToken(req, res);
    }

    return next();
  };
};
