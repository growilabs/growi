import { CHAT_INTEGRATION_PEER_PREFIX } from './consts';

/**
 * The single matcher for "is this request path served by the proxy-facing
 * `/peer` sub-tree?".
 *
 * Every middleware that has to treat those requests differently -- the raw
 * body parsing, and the exclusions from input sanitization, session, csurf and
 * `passport.session()` in `server/crowi/express-init.js`, plus the entry in
 * `server/routes/avoid-session-routes.js` -- must decide it through this one
 * function. It used to be re-derived per call site, and the copies disagreed:
 * an anonymous caller could pick a casing that the router accepted but the
 * exclusions did not recognise, so the request was served while the sanitize
 * walk ran over the raw body it exists to stay away from and the app-wide
 * session (`saveUninitialized`) wrote a document for it.
 *
 * Two properties, both load-bearing:
 *
 * - **Segment-aware.** The bare prefix and anything below it match; a
 *   similar-looking sibling such as `/peering` does not.
 * - **Case-insensitive.** Express matches routes without
 *   `case sensitive routing`, i.e. path-to-regexp compiles its pattern with
 *   the `i` flag and nothing else, so `/_API/V3/…/PEER/command` reaches the
 *   `/peer` router. This matcher carries the same single `i` flag rather than
 *   lower-casing the path, so its notion of "same letter" is exactly the
 *   router's -- lower-casing folds a few non-ASCII characters (U+212A KELVIN
 *   SIGN to `k`, say) that a non-unicode `i` regex does not, which would make
 *   the exclusions apply to paths the router never routes here.
 *
 * `RegExp.escape` is safe here: this pattern is evaluated in-process by V8 and
 * is never sent to MongoDB (see `.claude/rules/mongodb-regex.md`).
 */
const PEER_PATH_PATTERN = new RegExp(
  `^${RegExp.escape(CHAT_INTEGRATION_PEER_PREFIX)}(?:/|$)`,
  'i',
);

export const isChatIntegrationPeerPath = (path: string): boolean =>
  PEER_PATH_PATTERN.test(path);
