import type {
  AccessTokenParser,
  AccessTokenParserReq,
} from '@growi/core/dist/interfaces/server';

import { parserForAccessToken } from '~/server/middlewares/access-token-parser/access-token.js';
import { parserForApiToken } from '~/server/middlewares/access-token-parser/api-token.js';
import loggerFactory from '~/utils/logger/index.js';

const logger = loggerFactory('growi:middleware:access-token-parser');

export type { AccessTokenParser, AccessTokenParserReq };

export const accessTokenParser: AccessTokenParser = (scopes, opts) => {
  // Named function so the route-middleware snapshot tool can identify this
  // handler in the apiv3 auth chain.
  return async function accessTokenParserMw(req, res, next): Promise<void> {
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
