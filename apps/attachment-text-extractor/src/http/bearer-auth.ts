import { createHash, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

import type { AppEnv } from './app-env';
import { errorAnswer } from './early-answer';

// The only paths answered without a token (Req 1.6); every other one, an
// unknown one included, needs it, and is checked before anything else runs.
const OPEN_PATHS: ReadonlySet<string> = new Set([
  '/healthz',
  '/readyz',
  '/openapi.json',
]);

const SCHEME = 'Bearer ';

// Matched on the request target as sent, not on the path routing sees: the
// URL parser resolves "/./healthz" or "/%68ealthz" to an open path, which must
// still need the token. A target that matches exactly holds no "." segment or
// escape, so it routes to that very path.
const isOpen = (target = ''): boolean => {
  const query = target.indexOf('?');
  return OPEN_PATHS.has(query === -1 ? target : target.slice(0, query));
};

// Equal-length digests: the comparison neither throws on a length mismatch
// nor tells how long the token is.
const digest = (bytes: Buffer): Buffer =>
  createHash('sha256').update(bytes).digest();

export const bearerAuth = (token: string): MiddlewareHandler<AppEnv> => {
  const expected = digest(Buffer.from(token, 'utf8'));
  return async (c, next) => {
    if (isOpen(c.env.incoming.url)) {
      await next();
      return;
    }
    // Node keeps the first of two Authorization lines, as Starlette does;
    // c.req.header() would join them with ", " (research.md 16.9).
    const header = c.env.incoming.headers.authorization ?? '';
    // Node hands header values over as latin-1: these are the bytes sent.
    const sent = header.startsWith(SCHEME)
      ? digest(Buffer.from(header.slice(SCHEME.length), 'latin1'))
      : null;
    if (sent === null || !timingSafeEqual(sent, expected)) {
      return errorAnswer(
        c,
        401,
        'unauthorized',
        'Missing or invalid Bearer token',
      );
    }
    await next();
  };
};
