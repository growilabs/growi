import { removeTrailingSlash } from '@growi/core/dist/utils/path-utils';
import urljoin from 'url-join';

import { drawioAssetProxyUrl } from '../../consts';

import './drawio-globals';

/** The configured instance's own base, without the query DRAWIO_URI may carry. */
const instanceBaseUrl = (drawioUri: string): string => {
  const url = new URL(drawioUri);
  return removeTrailingSlash(`${url.origin}${url.pathname}`);
};

/**
 * Point every asset location baked into viewer-static.min.js at the configured instance.
 *
 * Must run BEFORE viewer-static.min.js evaluates. Two reasons, and the second is the one
 * that makes doing it afterwards impossible:
 *
 *   1. Each of these globals is initialised as `window.X = window.X || <baked value>`, so
 *      a value written here is the one that survives.
 *   2. mxStencilRegistry.libraries is *built out of* STENCIL_PATH and SHAPES_PATH while
 *      the bundle evaluates. Rewriting those library entries after the fact is therefore
 *      both too late and incomplete: mxStencilRegistry.getStencil() also falls back to
 *      reading STENCIL_PATH directly, so a stencil requested through that fallback keeps
 *      going to the baked-in location no matter what the library entries say.
 *
 * Assets the viewer reads with XMLHttpRequest go through GROWI's own origin, because a
 * self-hosted draw.io sends no Access-Control-Allow-Origin header and the browser refuses
 * the read. Assets loaded as <img> are not subject to that and are read from the instance
 * directly.
 *
 * Writing the same values again is harmless, so this may be called on every render.
 * refs: https://github.com/growilabs/growi/issues/10726
 */
export const rebaseDrawioAssetPaths = (drawioUri: string): void => {
  const base = instanceBaseUrl(drawioUri);

  window.STENCIL_PATH = drawioAssetProxyUrl('stencils');
  window.SHAPES_PATH = drawioAssetProxyUrl('shapes');
  window.STYLE_PATH = drawioAssetProxyUrl('styles');

  window.GRAPH_IMAGE_PATH = urljoin(base, 'img');
  window.mxBasePath = urljoin(base, 'mxgraph');
  window.mxImageBasePath = urljoin(base, 'mxgraph/images');

  window.DRAWIO_LIGHTBOX_URL = base;
};
