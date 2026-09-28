import { DRAWIO_ASSET_PROXY_PATH } from '~/features/drawio/consts';

/**
 * Path patterns that Express serves directly, with no corresponding Next.js
 * page under `apps/app/src/pages/**`. Kept in sync with the route
 * registrations in `server/routes/index.js` -- when a route is added or
 * removed there, check whether this list needs the same change. See the
 * `next-express-route-consistency` skill (apps/app/.claude/skills) for a
 * cross-check against the real route table and page files.
 */
const EXPRESS_EXCLUSIVE_PATH_PATTERNS: readonly RegExp[] = [
  /^\/vault\.git(\/.*)?$/,
  /^\/passport(\/.*)?$/,
  /^\/ogp(\/.*)?$/,
  /^\/download(\/.*)?$/,
  /^\/attachment(\/.*)?$/,
  /^\/uploads(\/.*)?$/,
  new RegExp(`^${DRAWIO_ASSET_PROXY_PATH}(/.*)?$`),
  /^\/_apix?(\/.*)?$/,
  // The page-markdown endpoint (server/routes/index.js) intercepts any GET
  // path ending in `.md` before the page router ever sees it.
  /\.md$/,
  // Legacy reserved segments with neither a page file nor an active Express
  // route today; excluded conservatively since nothing is served there.
  /^\/(register|logout|files|paste|comments)(\/.*|$)/,
];

/**
 * Paths that are never a valid navigation target regardless of routing --
 * malformed, reserved-looking, or path-traversal-shaped. This is unrelated
 * to the Express-vs-Next.js distinction above; it is a safety net so
 * NextLink never hands a garbage href to next/link.
 */
const UNSAFE_PATH_PATTERNS: readonly RegExp[] = [
  /\^|\$|\*|\+|#|<|>|%|\?/,
  /^\/-\/.*/,
  /^\/?https?:\/\/.+$/,
  /\/{2,}/,
  /\s+\/\s+/,
  /\\/,
  /^(\.\.)$/,
  /(\/\.\.)\/?/,
  /\/edit$/,
  /^(\/.+){130,}$/,
];

const NON_NEXT_PAGE_PATTERNS: readonly RegExp[] = [
  ...EXPRESS_EXCLUSIVE_PATH_PATTERNS,
  ...UNSAFE_PATH_PATTERNS,
];

/**
 * Whether `pathname` is rendered by a Next.js page route, as opposed to a
 * path Express serves directly with no corresponding page (e.g. an OAuth
 * callback or an attachment download) or a malformed/unsafe path. Used to
 * decide whether a link can use Next's client-side router or must fall back
 * to a full page load.
 */
export const isNextPageRoute = (pathname: string): boolean => {
  return !NON_NEXT_PAGE_PATTERNS.some((pattern) => pattern.test(pathname));
};
