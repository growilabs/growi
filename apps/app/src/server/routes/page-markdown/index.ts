import { SCOPE } from '@growi/core/dist/interfaces';
import type { NextFunction, Response, Router } from 'express';
import express from 'express';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import loginRequiredFactory from '~/server/middlewares/login-required';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import type Crowi from '../../crowi';
import { parseMarkdownRequest } from './parse-markdown-request';
import { respondWithPageMarkdown } from './respond-with-page-markdown';

const logger = loggerFactory('growi:routes:page-markdown');

const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8';

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

/**
 * Express route that intercepts Markdown requests for a page and serves the
 * page's Markdown representation, falling through to the existing HTML flow
 * for everything else.
 *
 * Registered immediately before the catch-all in routes/index.js. It handles
 * GET only (mounted via router.get). The cheap, pure `parseMarkdownRequest`
 * runs for every GET; only when it detects a Markdown request are the
 * authorization middlewares invoked -- non-Markdown traffic skips authz
 * entirely via `next('route')`, which exits this router and lets the request
 * reach the catch-all with zero added auth overhead.
 */
export const pageMarkdownRouteFactory = (crowi: Crowi): Router => {
  const parseAccessToken = accessTokenParser([SCOPE.READ.FEATURES.PAGE], {
    acceptLegacy: true,
  });
  // Guest-allowed variant: mirrors the catch-all's own `loginRequired`, so the
  // anonymous-access decision (Requirement 3.3 / 3.4) matches HTML delivery.
  const loginRequired = loginRequiredFactory(crowi, true);

  const router = express.Router();

  router.get(
    '/*',
    // Gate: classify the request. Non-Markdown GETs skip the remaining
    // handlers (authz + responder) via next('route') and fall through to the
    // catch-all -- authorization is composed only for Markdown requests.
    (req: CrowiRequest, _res: Response, next: NextFunction) => {
      const intent = parseMarkdownRequest(
        req.path,
        req.headers.accept,
        normalizeFormatQuery(req.query.format),
      );
      if (intent.kind === 'none') {
        return next('route');
      }
      return next();
    },
    parseAccessToken,
    loginRequired,
    async (req: CrowiRequest, res: Response, next: NextFunction) => {
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
            return res.status(200).send(resolution.markdown);
          case 'forbidden':
            return res.status(403).send(resolution.markdown);
          case 'notFound':
            return res.status(404).send(resolution.markdown);
        }
      } catch (err) {
        logger.error('Failed to respond with page markdown', err);
        return next(err);
      }
    },
  );

  return router;
};
