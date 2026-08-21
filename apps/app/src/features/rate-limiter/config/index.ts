export type IApiRateLimitConfig = {
  method: string;
  maxRequests: number;
  usersPerIpProspection?: number;
};
export type IApiRateLimitEndpointMap = {
  [endpoint: string]: IApiRateLimitConfig;
};

export const DEFAULT_MAX_REQUESTS = 500;
export const DEFAULT_DURATION_SEC = 60;
export const DEFAULT_USERS_PER_IP_PROSPECTION = 5;

const MAX_REQUESTS_TIER_1 = 5;
const MAX_REQUESTS_TIER_2 = 20;
const MAX_REQUESTS_TIER_3 = 50;
const MAX_REQUESTS_TIER_4 = 100;

// default config without reg exp
//
// IMPORTANT — each key here MUST be the FULLY-MOUNTED path.
// The middleware looks the key up as `configWithoutRegExp[req.path]` (see
// middleware/factory.ts), an exact string match against the path the request
// actually arrives on. A key that omits the router's mount prefix therefore
// matches nothing at all and — silently, with no error anywhere — the endpoint
// falls back to the permissive default (DEFAULT_MAX_REQUESTS 500 ×
// DEFAULT_USERS_PER_IP_PROSPECTION 5 = 2500 req/min/IP).
// The auth endpoints below live on apiV3AuthRouter, mounted at '/_api/v3'
// (server/routes/index.js), so they are keyed '/_api/v3/…'.
export const defaultConfig: IApiRateLimitEndpointMap = {
  '/_api/v3/healthcheck': {
    method: 'GET',
    maxRequests: 60,
    usersPerIpProspection: 1,
  },
  // The scrypt-running POST lives on routerForAdmin, also mounted at '/_api/v3',
  // so the bare '/installer' key never throttled it.
  '/_api/v3/installer': {
    method: 'POST',
    maxRequests: MAX_REQUESTS_TIER_1,
    usersPerIpProspection: 1,
  },
  // The legacy installer PAGE (`app.get('/installer')`, server/routes/index.js)
  // still lives at this path and must keep its own entry. A key is looked up by
  // `req.path` alone — the method is only consulted for `maxRequests`, while
  // `usersPerIpProspection` applies unconditionally (middleware/factory.ts) — so
  // dropping this key would silently widen the page's per-IP ceiling 5x.
  '/installer': {
    method: 'GET',
    maxRequests: MAX_REQUESTS_TIER_3,
    usersPerIpProspection: 1,
  },
  // The legacy `POST /login` route no longer exists, so a '/login' key matched
  // nothing and login fell back to 2500 req/min/IP — enough to saturate the libuv
  // threadpool now that verification runs scrypt (~128MiB, ~100ms per attempt).
  '/_api/v3/login': {
    method: 'POST',
    maxRequests: MAX_REQUESTS_TIER_1,
    usersPerIpProspection: 100,
  },
  // routerForAuth.use('/invited', …) + router.post('/'). NOTE: the previous bare
  // '/invited' key did match the live `app.get('/invited')` page route, but its
  // method is POST so it never applied a limit there — retargeting it to the
  // mounted apiv3 path leaves that page's throttling unchanged.
  '/_api/v3/invited': {
    method: 'POST',
    maxRequests: MAX_REQUESTS_TIER_2,
  },
  // Unauthenticated and reaches setPassword() → scrypt, same DoS surface as login.
  '/_api/v3/register': {
    method: 'POST',
    maxRequests: MAX_REQUESTS_TIER_1,
    usersPerIpProspection: 20,
  },
  // Likewise unauthenticated and scrypt-bearing.
  '/_api/v3/user-activation/register': {
    method: 'POST',
    maxRequests: MAX_REQUESTS_TIER_1,
    usersPerIpProspection: 20,
  },
  '/_api/login/testLdap': {
    method: 'POST',
    maxRequests: MAX_REQUESTS_TIER_2,
    usersPerIpProspection: 1,
  },
  // The live route is `router.get('/check-username')` on the apiv3 router
  // (mounted at '/_api/v3'); the old '/_api/check_username' key matched nothing.
  '/_api/v3/check-username': {
    method: 'GET',
    maxRequests: MAX_REQUESTS_TIER_3,
  },
};

const isDev = process.env.NODE_ENV === 'development';
const defaultConfigWithRegExpForDev: IApiRateLimitEndpointMap = isDev
  ? {
      '/__nextjs_original-stack-frame': {
        method: 'GET',
        maxRequests: Infinity,
      },
    }
  : {};

// default config with reg exp
export const defaultConfigWithRegExp: IApiRateLimitEndpointMap = {
  ...defaultConfigWithRegExpForDev,

  '/forgot-password/.*': {
    method: 'ALL',
    maxRequests: MAX_REQUESTS_TIER_1,
  },
  '/user-activation/.*': {
    method: 'GET',
    maxRequests: MAX_REQUESTS_TIER_1,
  },
  '/attachment/[0-9a-z]{24}': {
    method: 'GET',
    maxRequests: MAX_REQUESTS_TIER_4,
  },
  '/download/[0-9a-z]{24}': {
    method: 'GET',
    maxRequests: MAX_REQUESTS_TIER_4,
  },
  '/share/[0-9a-z]{24}': {
    method: 'GET',
    maxRequests: MAX_REQUESTS_TIER_4,
  },
};
