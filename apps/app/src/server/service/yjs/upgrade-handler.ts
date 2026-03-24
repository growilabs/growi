import type { IPage, IUserHasId } from '@growi/core';
import { YJS_WEBSOCKET_BASE_PATH } from '@growi/core/dist/consts';
import expressSession from 'express-session';
import type { IncomingMessage, ServerResponse } from 'http';
import mongoose from 'mongoose';
import passport from 'passport';
import type { Duplex } from 'stream';

import type { SessionConfig } from '~/interfaces/session-config';
import loggerFactory from '~/utils/logger';

import type { PageModel } from '../../models/page';

const logger = loggerFactory('growi:service:yjs:upgrade-handler');

type AuthenticatedRequest = IncomingMessage & {
  user?: IUserHasId;
};

/**
 * Connect-style middleware that operates on raw Node.js HTTP types.
 * Express middleware (express-session, passport) is compatible because
 * express.Request extends IncomingMessage and express.Response extends ServerResponse.
 */
type ConnectMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void;

/**
 * Run a Connect-style middleware against a raw IncomingMessage.
 * Safe for express-session, passport.initialize(), and passport.session() which
 * only read/write `req` properties and call `next()` — they never write to `res`.
 */
const runMiddleware = (
  middleware: ConnectMiddleware,
  req: IncomingMessage,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const stubRes = {} as ServerResponse;
    middleware(req, stubRes, (err?: unknown) => {
      if (err) return reject(err);
      resolve();
    });
  });

/**
 * Extracts pageId from upgrade request URL.
 * Expected format: /yjs/{pageId}
 */
const pageIdPattern = new RegExp(`^${YJS_WEBSOCKET_BASE_PATH}/([a-f0-9]{24})`);
const extractPageId = (url: string | undefined): string | null => {
  if (url == null) return null;
  const match = url.match(pageIdPattern);
  return match?.[1] ?? null;
};

/**
 * Rejects a WebSocket upgrade request with an HTTP error response.
 */
const rejectUpgrade = (
  socket: Duplex,
  statusCode: number,
  message: string,
): void => {
  socket.write(`HTTP/1.1 ${statusCode} ${message}\r\n\r\n`);
  socket.destroy();
};

export type UpgradeResult =
  | { authorized: true; request: AuthenticatedRequest; pageId: string }
  | { authorized: false; statusCode: number };

/**
 * Creates an upgrade handler that authenticates WebSocket connections
 * using the existing express-session + passport mechanism.
 */
export const createUpgradeHandler = (sessionConfig: SessionConfig) => {
  const sessionMiddleware = expressSession(sessionConfig as any);
  const passportInit = passport.initialize();
  const passportSession = passport.session();

  return async (
    request: IncomingMessage,
    socket: Duplex,
    _head: Buffer,
  ): Promise<UpgradeResult> => {
    const pageId = extractPageId(request.url);
    if (pageId == null) {
      logger.warn('Invalid URL path for Yjs upgrade', { url: request.url });
      rejectUpgrade(socket, 400, 'Bad Request');
      return { authorized: false, statusCode: 400 };
    }

    try {
      // Run session + passport middleware chain
      await runMiddleware(sessionMiddleware as ConnectMiddleware, request);
      await runMiddleware(passportInit as ConnectMiddleware, request);
      await runMiddleware(passportSession as ConnectMiddleware, request);
    } catch (err) {
      logger.warn('Session/passport middleware failed on upgrade', { err });
      rejectUpgrade(socket, 401, 'Unauthorized');
      return { authorized: false, statusCode: 401 };
    }

    const user = (request as AuthenticatedRequest).user ?? null;

    // Check page access
    const Page = mongoose.model<IPage, PageModel>('Page');
    const isAccessible = await Page.isAccessiblePageByViewer(pageId, user);

    if (!isAccessible) {
      const statusCode = user == null ? 401 : 403;
      const message = user == null ? 'Unauthorized' : 'Forbidden';
      logger.warn(`Yjs upgrade rejected: ${message}`, {
        pageId,
        userId: user?._id,
      });
      rejectUpgrade(socket, statusCode, message);
      return { authorized: false, statusCode };
    }

    return {
      authorized: true,
      request: request as AuthenticatedRequest,
      pageId,
    };
  };
};
