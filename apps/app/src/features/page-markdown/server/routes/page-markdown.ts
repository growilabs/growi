import type { NextFunction, Response } from 'express';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import type Crowi from '~/server/crowi';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import { parseMarkdownRequest } from '../services/parse-markdown-request';
import { respondWithPageMarkdown } from '../services/respond-with-page-markdown';

const logger = loggerFactory('growi:features:page-markdown:routes');

const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8';

type MarkdownRequestHandler = (
  req: CrowiRequest,
  res: Response,
  next: NextFunction,
) => void | Promise<void>;

/**
 * The two route handlers that make up the page-markdown interception.
 *
 * They are registered by routes/index.js in its declarative route-table
 * style, with the authorization middlewares composed BETWEEN them:
 *
 *   app.get('/*', handlers.skipUnlessMarkdownRequest,
 *                 accessTokenParser(...), loginRequired,
 *                 handlers.respond);
 *
 * so non-markdown GETs exit via next('route') before any authz work runs,
 * and markdown requests share the exact same middleware instances as the
 * rest of the route table.
 */
export interface PageMarkdownHandlers {
  /**
   * Gate: classify the request with the cheap, pure parseMarkdownRequest.
   * Non-markdown GETs skip the rest of the route (authz + responder) via
   * next('route') and fall through to the catch-all with zero added
   * overhead.
   */
  readonly skipUnlessMarkdownRequest: MarkdownRequestHandler;
  /**
   * Responder: resolve the page and serve the markdown document
   * (200/403/404), or fall through to the existing HTML delivery via
   * next() when a literal `.md` page wins (Requirement 2.1).
   */
  readonly respond: MarkdownRequestHandler;
}

/**
 * Normalize the raw `format` query value. Express types it loosely
 * (string | string[] | ParsedQs | ...); the parser only cares about a plain
 * string, so take the first entry of a repeated param and drop anything else.
 */
function normalizeFormatQuery(format: unknown): string | undefined {
  if (typeof format === 'string') {
    return format;
  }
  if (Array.isArray(format)) {
    const first = format[0];
    return typeof first === 'string' ? first : undefined;
  }
  return undefined;
}

/**
 * Resolve the origin (protocol + host) used to build the absolute URLs in the
 * navigation footer. Prefer the configured canonical Site URL; fall back to
 * the request's own scheme + host when it is not set or not a valid URL.
 */
function resolveOrigin(req: CrowiRequest): string {
  const siteUrl = configManager.getConfig('app:siteUrl');
  if (siteUrl != null) {
    try {
      return new URL(siteUrl).origin;
    } catch {
      // Configured value is not a valid URL -> fall back to the request origin.
    }
  }
  return `${req.protocol}://${req.get('host') ?? ''}`;
}

export const createPageMarkdownHandlers = (
  crowi: Crowi,
): PageMarkdownHandlers => {
  const skipUnlessMarkdownRequest: MarkdownRequestHandler = (
    req,
    _res,
    next,
  ) => {
    const intent = parseMarkdownRequest(
      req.path,
      req.headers.accept,
      normalizeFormatQuery(req.query.format),
    );
    if (intent.kind === 'none') {
      return next('route');
    }
    return next();
  };

  const respond: MarkdownRequestHandler = async (req, res, next) => {
    try {
      const resolution = await respondWithPageMarkdown(crowi, {
        reqPath: req.path,
        accept: req.headers.accept,
        formatQuery: normalizeFormatQuery(req.query.format),
        user: req.user,
        origin: resolveOrigin(req),
      });

      if (resolution.type === 'passthrough') {
        // A literal `.md` page exists (Requirement 2.1): defer to the
        // existing HTML delivery by falling through to the catch-all.
        return next();
      }

      // The same URL serves either HTML or markdown depending on Accept,
      // and markdown bodies are viewer-specific: mark the response
      // Accept-varying and non-cacheable so shared caches (reverse proxy /
      // CDN) never store a markdown variant and hand it to a browser.
      res.vary('Accept');
      res.set(
        'Cache-Control',
        'private, no-cache, no-store, max-age=0, must-revalidate',
      );
      res.type(MARKDOWN_CONTENT_TYPE);

      switch (resolution.type) {
        case 'ok':
          res.status(200).send(resolution.markdown);
          return;
        case 'forbidden':
          res.status(403).send(resolution.markdown);
          return;
        case 'notFound':
          res.status(404).send(resolution.markdown);
          return;
      }
    } catch (err) {
      logger.error('Failed to respond with page markdown', err);
      return next(err);
    }
  };

  return { skipUnlessMarkdownRequest, respond };
};
