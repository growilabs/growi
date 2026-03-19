import type { IPage, IUserHasId } from '@growi/core';
import type { RequestHandler } from 'express';
import expressSession from 'express-session';
import type { IncomingMessage, ServerResponse } from 'http';
import mongoose from 'mongoose';
import passport from 'passport';
import type { Duplex } from 'stream';

import loggerFactory from '~/utils/logger';

import type { PageModel } from '../../models/page';

const logger = loggerFactory('growi:service:yjs:upgrade-handler');

type SessionConfig = {
  rolling: boolean;
  secret: string;
  resave: boolean;
  saveUninitialized: boolean;
  cookie: { maxAge: number };
  genid: (req: { path: string }) => string;
  name?: string;
  store?: unknown;
};

type AuthenticatedRequest = IncomingMessage & {
  user?: IUserHasId;
};

/**
 * Run an Express-style middleware against a raw IncomingMessage
 */
const runMiddleware = (
  middleware: RequestHandler,
  req: IncomingMessage,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const fakeRes = {} as ServerResponse;
    middleware(req as any, fakeRes as any, (err?: unknown) => {
      if (err) return reject(err);
      resolve();
    });
  });

/**
 * Extracts pageId from upgrade request URL.
 * Expected format: /yjs/{pageId}
 */
const extractPageId = (url: string | undefined): string | null => {
  if (url == null) return null;
  const match = url.match(/^\/yjs\/([a-f0-9]{24})/);
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
      await runMiddleware(sessionMiddleware as RequestHandler, request);
      await runMiddleware(passportInit as RequestHandler, request);
      await runMiddleware(passportSession as RequestHandler, request);
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
