import type { Request, Response, Router } from 'express';
import express from 'express';

import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import { PROXIED_ASSET_DIRS, VIEWER_DIAGRAMS_NET_ORIGIN } from '../../consts';

const logger = loggerFactory('growi:features:drawio:routes:drawio-assets');

/**
 * Everything draw.io ships under the proxied directories: the library definitions
 * themselves, plus the images and fonts a few of them reference.
 *
 * The Content-Type is decided from this map rather than copied from the instance's answer.
 * That is on purpose: the response is served from GROWI's origin, so letting an upstream
 * `text/html` through would make it a same-origin document.
 */
const CONTENT_TYPE_BY_EXTENSION = {
  '.xml': 'application/xml; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
} as const;

type AllowedExtension = keyof typeof CONTENT_TYPE_BY_EXTENSION;

const ALLOWED_EXTENSIONS = Object.keys(
  CONTENT_TYPE_BY_EXTENSION,
) as AllowedExtension[];

const TIMEOUT_MS = 10_000;

// Stencil libraries are big: stencils/aws4.xml alone is 6.5 MB on draw.io 31.1.5. The cap
// is a runaway guard, not a budget, so it is set well clear of that — a limit that a real
// library could grow past would turn into shapes that silently stop rendering.
const MAX_CONTENT_LENGTH = 64 * 1024 * 1024;

// A stencil library is immutable for a given draw.io version, and a draw.io upgrade
// changes the whole instance, so a day of caching is safe and saves a request per library.
const CACHE_CONTROL = 'public, max-age=86400';

const assetPathRegExp = new RegExp(
  `^(?:${PROXIED_ASSET_DIRS.join('|')})/(?:[\\w.-]+/)*[\\w-]+(?:${ALLOWED_EXTENSIONS.map(
    (ext) => `\\${ext}`,
  ).join('|')})$`,
);

/**
 * The extension to serve `assetPath` as, or undefined when it is not one of draw.io's own
 * library files.
 *
 * This is the only thing standing between the route and a request-controlled fetch, so it
 * is a strict allow-list rather than a set of rejections: the path must sit under one of
 * {@link PROXIED_ASSET_DIRS}, may only contain word characters, dots and dashes, and must
 * end in a known library extension. `..` is refused outright — that character class
 * permits dots, so traversal has to be excluded separately.
 *
 * Returning the extension rather than a boolean keeps the Content-Type decision tied to
 * the check that justifies it, so the route needs no unchecked narrowing.
 */
export const proxiableAssetExtension = (
  assetPath: string,
): AllowedExtension | undefined => {
  if (assetPath.length === 0) return undefined;
  if (assetPath.includes('..')) return undefined;
  if (!assetPathRegExp.test(assetPath)) return undefined;

  return ALLOWED_EXTENSIONS.find((ext) => assetPath.endsWith(ext));
};

/**
 * The asset's location on the configured instance, or undefined when the request would
 * lead anywhere else.
 *
 * Origin and base path come only from `app:drawioUri`, never from the request. On top of
 * that, `assetPath` is *resolved* against the instance's own subtree rather than
 * concatenated onto it, and the result is then required to still sit inside that subtree.
 * Resolving first is what makes the check meaningful: a traversal segment is normalised
 * away before it is compared, instead of being passed along verbatim. This is defence in
 * depth behind {@link proxiableAssetExtension} — the allow-list should already have refused
 * anything of the sort, and this makes it so that a hole in it still cannot reach another
 * host or climb out of the subtree.
 *
 * Any query DRAWIO_URI carries (`?offline=1` and friends) is dropped: it configures the
 * editor and means nothing to a static asset.
 */
export const buildAssetUrl = (
  drawioUri: string,
  assetPath: string,
): string | undefined => {
  let instance: URL;
  try {
    instance = new URL(drawioUri);
  } catch {
    return undefined;
  }

  const subtree = `${instance.origin}${
    instance.pathname.endsWith('/')
      ? instance.pathname
      : `${instance.pathname}/`
  }`;

  const resolved = new URL(assetPath, subtree).href;
  if (!resolved.startsWith(subtree)) {
    return undefined;
  }

  return resolved;
};

/**
 * Read one asset verbatim, or undefined when it could not be read.
 *
 * Uses fetch rather than `~/utils/axios`, which is not a byte-faithful transport: its
 * transformResponse chain runs convertStringsToDates over the body, and that walks any
 * non-array object key by key — so a Buffer comes back as a plain `{0: …, 1: …}` object and
 * the bytes are lost. (`routes/ogp.ts` sidesteps the same wrapper for the same reason.)
 */
export const readAsset = async (
  url: string,
  { onSuccess }: { onSuccess?: () => void } = {},
): Promise<Buffer | undefined> => {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // a redirect would leave the origin this route resolved the asset against;
      // undici surfaces the 3xx itself, which !ok below rejects
      redirect: 'manual',
    });

    if (!response.ok) {
      logger.debug({ url, status: response.status }, 'Asset was not served');
      return undefined;
    }

    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength > MAX_CONTENT_LENGTH) {
      logger.warn(
        { url, byteLength: body.byteLength },
        'Refused a draw.io asset larger than the allowed size',
      );
      return undefined;
    }

    onSuccess?.();
    return body;
  } catch (err) {
    logger.debug({ url, err }, 'Could not read a draw.io asset');
    return undefined;
  }
};

/**
 * Serve draw.io's stencil and shape libraries from GROWI's own origin.
 *
 * The viewer reads them with XMLHttpRequest and a self-hosted draw.io sends no
 * Access-Control-Allow-Origin header, so read cross-origin they are refused by the browser
 * and shapes render as empty rectangles. draw.io's own viewer.diagrams.net does send the
 * header, which is why this only became necessary once DRAWIO_URI could point elsewhere.
 *
 * Left unauthenticated deliberately. The client counterpart runs for readers of shared
 * pages too, who may not be logged in, and there is no GROWI data here to protect: the
 * target host is fixed by server configuration and the path allow-list admits only
 * draw.io's own library files.
 *
 * refs: https://github.com/growilabs/growi/issues/10726
 */
export const drawioAssetsRouterFactory = (): Router => {
  const router = express.Router();

  router.get('/*', async (req: Request, res: Response) => {
    const assetPath = req.params[0] ?? '';

    const extension = proxiableAssetExtension(assetPath);
    if (extension == null) {
      logger.debug({ assetPath }, 'Refused a draw.io asset path');
      res.status(404).end();
      return;
    }

    const drawioUri = configManager.getConfig('app:drawioUri');
    const assetUrl = buildAssetUrl(drawioUri, assetPath);
    if (assetUrl == null) {
      logger.warn({ drawioUri, assetPath }, 'Refused a draw.io asset location');
      res.status(404).end();
      return;
    }

    // Older draw.io images ship no stencils/ or shapes/ directory at all (observed absent
    // on 28.2.9, present on 31.1.5), so on such an instance the library exists only on
    // draw.io's own host. Built through the same check as the instance URL, so it cannot
    // lead anywhere but under that origin.
    const fallbackUrl = buildAssetUrl(VIEWER_DIAGRAMS_NET_ORIGIN, assetPath);

    const body =
      (await readAsset(assetUrl)) ??
      // Reading the fallback here rather than in the browser keeps the response
      // same-origin and needs no CORS header; on a network with no route out it simply
      // fails, which is no worse than the 404 it replaces.
      (fallbackUrl == null
        ? undefined
        : await readAsset(fallbackUrl, {
            onSuccess: () =>
              logger.info(
                { assetPath, drawioUri },
                'The configured draw.io instance does not ship this library; read it from draw.io instead',
              ),
          }));

    if (body == null) {
      res.status(502).end();
      return;
    }

    res.set({
      'Content-Type': CONTENT_TYPE_BY_EXTENSION[extension],
      'Cache-Control': CACHE_CONTROL,
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(body);
  });

  return router;
};
