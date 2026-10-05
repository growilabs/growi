import type { IPage, IUserHasId } from '@growi/core';
import { YJS_WEBSOCKET_BASE_PATH } from '@growi/core/dist/consts';
import expressSession from 'express-session';
import type { IncomingMessage, ServerResponse } from 'http';
import mongoose from 'mongoose';
import passport from 'passport';
import type { Duplex } from 'stream';

import type { SessionConfig } from '~/interfaces/session-config';
import loggerFactory from '~/utils/logger';

import type Crowi from '../../crowi';
import { excludeReadOnlyUser } from '../../middlewares/exclude-read-only-user';
import loginRequiredFactory from '../../middlewares/login-required';
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
 * Run an authorization middleware (loginRequired, excludeReadOnlyUser) that
 * rejects by writing an HTTP response. Its response methods are captured and
 * turned into a status code, since there is no HTTP response on an upgrade.
 * Resolves null when the middleware calls next().
 */
const runAuthzMiddleware = (
  middleware: ConnectMiddleware,
  req: IncomingMessage,
): Promise<number | null> =>
  new Promise((resolve, reject) => {
    const captureRes = {
      sendStatus: (statusCode: number) => resolve(statusCode),
      redirect: () => resolve(403),
      apiv3Err: () => resolve(403),
    } as unknown as ServerResponse;
    middleware(req, captureRes, (err?: unknown) => {
      if (err) return reject(err);
      resolve(null);
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
 * Writes an HTTP error response to the socket.
 * Does NOT close the socket — the caller (yjs.ts) manages socket lifecycle
 * so that guardSocket can safely intercept end/destroy during async auth.
 */
const writeErrorResponse = (
  socket: Duplex,
  statusCode: number,
  message: string,
): void => {
  socket.write(`HTTP/1.1 ${statusCode} ${message}\r\n\r\n`);
};

export type UpgradeResult =
  | { authorized: true; request: AuthenticatedRequest; pageId: string }
  | { authorized: false; statusCode: number };

/**
 * Creates an upgrade handler that authenticates WebSocket connections
 * using the existing express-session + passport mechanism.
 */
export const createUpgradeHandler = (
  sessionConfig: SessionConfig,
  crowi: Crowi,
) => {
  const sessionMiddleware = expressSession(sessionConfig as any);
  const passportInit = passport.initialize();
  const passportSession = passport.session();

  // Same gate as the page update API (update-page.ts). The fallback replaces
  // the default redirect-to-login, which would also write to the session.
  const editPermissionMiddlewares = [
    loginRequiredFactory(crowi, false, (_req, res) => res.sendStatus(401)),
    excludeReadOnlyUser,
  ] as unknown as ConnectMiddleware[];

  return async (
    request: IncomingMessage,
    socket: Duplex,
    _head: Buffer,
  ): Promise<UpgradeResult> => {
    const pageId = extractPageId(request.url);
    if (pageId == null) {
      logger.warn({ url: request.url }, 'Invalid URL path for Yjs upgrade');
      writeErrorResponse(socket, 400, 'Bad Request');
      return { authorized: false, statusCode: 400 };
    }

    try {
      // Run session + passport middleware chain
      await runMiddleware(sessionMiddleware as ConnectMiddleware, request);
      await runMiddleware(passportInit as ConnectMiddleware, request);
      await runMiddleware(passportSession as ConnectMiddleware, request);
    } catch (err) {
      logger.warn({ err }, 'Session/passport middleware failed on upgrade');
      writeErrorResponse(socket, 401, 'Unauthorized');
      return { authorized: false, statusCode: 401 };
    }

    // A Yjs connection can write to the document, so apply the same
    // middlewares as the page update API, not just the view access check.
    for (const middleware of editPermissionMiddlewares) {
      const rejectedStatus = await runAuthzMiddleware(middleware, request);
      if (rejectedStatus != null) {
        const message = rejectedStatus === 401 ? 'Unauthorized' : 'Forbidden';
        logger.warn(
          { pageId, userId: (request as AuthenticatedRequest).user?._id },
          `Yjs upgrade rejected: ${message}`,
        );
        writeErrorResponse(socket, rejectedStatus, message);
        return { authorized: false, statusCode: rejectedStatus };
      }
    }

    const user = (request as AuthenticatedRequest).user ?? null;

    // Check page access
    const Page = mongoose.model<IPage, PageModel>('Page');
    const isAccessible = await Page.isAccessiblePageByViewer(pageId, user);

    if (!isAccessible) {
      logger.warn(
        { pageId, userId: user?._id },
        'Yjs upgrade rejected: page is not accessible',
      );
      writeErrorResponse(socket, 403, 'Forbidden');
      return { authorized: false, statusCode: 403 };
    }

    return {
      authorized: true,
      request: request as AuthenticatedRequest,
      pageId,
    };
  };
};
