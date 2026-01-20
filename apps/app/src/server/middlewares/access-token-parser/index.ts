import type {
  AccessTokenParser,
  AccessTokenParserReq,
} from '@growi/core/dist/interfaces/server';

import loggerFactory from '~/utils/logger';

import { parserForAccessToken } from './access-token';
import { parserForApiToken } from './api-token';

const logger = loggerFactory('growi:middleware:access-token-parser');

export type { AccessTokenParser, AccessTokenParserReq };

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
