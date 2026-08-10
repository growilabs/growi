/**
 * The origin draw.io's own hosted viewer runs on. Anything else is a self-hosted
 * instance, which is what every adaptation in this feature exists for.
 */
export const DEFAULT_DRAWIO_ORIGIN = 'https://embed.diagrams.net';

/**
 * The host viewer-static.min.js bakes all of its asset locations into.
 *
 * Also the fallback for a library the configured instance does not ship: older draw.io
 * images carry no stencils/ or shapes/ directory, so for those the library exists only
 * here. See features/drawio/server/routes/drawio-assets.ts.
 */
export const VIEWER_DIAGRAMS_NET_ORIGIN = 'https://viewer.diagrams.net';

/**
 * Path GROWI serves draw.io's XMLHttpRequest-fetched assets from, on GROWI's own origin.
 *
 * The viewer reads stencil and shape definitions with XMLHttpRequest, and a self-hosted
 * draw.io answers without an Access-Control-Allow-Origin header, so the browser refuses
 * every cross-origin read. draw.io's own viewer.diagrams.net does send that header, which
 * is why the problem only appears once DRAWIO_URI points somewhere else.
 * refs: https://github.com/growilabs/growi/issues/10726
 */
export const DRAWIO_ASSET_PROXY_PATH = '/_drawio-assets';

/**
 * The asset subtrees reached through {@link DRAWIO_ASSET_PROXY_PATH}.
 *
 * Deliberately short: only what the viewer fetches with XMLHttpRequest belongs here.
 * Images and scripts are not subject to the same-origin rule and are read straight from
 * the configured instance, so proxying them would add load for nothing. The server side
 * also uses this list to decide what it is willing to forward.
 */
export const PROXIED_ASSET_DIRS = ['stencils', 'shapes', 'styles'] as const;

export type ProxiedAssetDir = (typeof PROXIED_ASSET_DIRS)[number];

/** The same-origin location the viewer should read `dir` from. */
export const drawioAssetProxyUrl = (dir: ProxiedAssetDir): string =>
  `${DRAWIO_ASSET_PROXY_PATH}/${dir}`;
