import type { AccessTokenParserReq } from '@growi/core/dist/interfaces/server';

import { extractBearerToken } from '~/server/middlewares/access-token-parser/extract-bearer-token.js';

// Canonical header name for passing an access token outside the Authorization header.
// Express lowercases incoming header keys, so indexing by this lowercase constant
// resolves the header case-insensitively. Mirrors X_GROWI_TRANSFER_KEY_HEADER_NAME.
export const X_GROWI_ACCESS_TOKEN_HEADER_NAME = 'x-growi-access-token';

/**
 * Resolve the access token from a request using the single source-of-truth precedence:
 * Bearer > X-GROWI-ACCESS-TOKEN header > access_token query > access_token body.
 *
 * A non-string X-GROWI-ACCESS-TOKEN value (e.g. an array from a duplicated header) is
 * coerced to `undefined` before the precedence chain, so resolution falls through to the
 * remaining sources instead of short-circuiting (3.4). `null` is returned only when no
 * string-typed source resolves.
 */
export const extractAccessToken = (
  req: AccessTokenParserReq,
): string | null => {
  const headerToken = req.headers[X_GROWI_ACCESS_TOKEN_HEADER_NAME];

  const token =
    extractBearerToken(req.headers.authorization) ??
    (typeof headerToken === 'string' ? headerToken : undefined) ??
    req.query.access_token ??
    req.body.access_token;

  return typeof token === 'string' ? token : null;
};
