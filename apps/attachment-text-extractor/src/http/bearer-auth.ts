import { createHash, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

import type { AppEnv } from './app-env';
import { errorAnswer } from './early-answer';
import { UNAUTHORIZED_ANSWER } from './error-table';
import { isOpenEndpoint } from './request-target';

const SCHEME = 'Bearer ';

// Equal-length digests: the comparison neither throws on a length mismatch
// nor tells how long the token is.
const digest = (bytes: Buffer): Buffer =>
  createHash('sha256').update(bytes).digest();

export const bearerAuth = (token: string): MiddlewareHandler<AppEnv> => {
  const expected = digest(Buffer.from(token, 'utf8'));
  return async (c, next) => {
    if (isOpenEndpoint(c.env.incoming.url)) {
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
      const { status, code, message } = UNAUTHORIZED_ANSWER;
      return errorAnswer(c, status, code, message);
    }
    await next();
  };
};
